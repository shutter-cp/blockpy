/**
 * Python Type Inferencer and Flow Analyzer
 * TIFA
 *
 * Depends on Skulpt
 * 
 * TIFA uses a number of simplifications of the Python language.
 *  * Variables cannot change type
 *  * Variables cannot be deleted
 *  * Complex types have to be homogenous
 *  * No introspection or reflective characteristics
 *  * No dunder methods
 *  * No closures (maybe?)
 *  * You cannot write a variable out of scope
 *  * You cannot read a mutable variable out of scope
 *  * No multiple inheritance
 *
 * Additionally, it reads the following as issues:
 *  * Cannot read a variable without having first written to it.
 *  * Cannot rewrite a variable unless it has been read.
 *
 * @constructor
 * @this {Tifa}
 */
function Tifa() {
    NodeVisitor.apply(this, Array.prototype.slice.call(arguments));
}
Tifa.prototype = new NodeVisitor();

/**
 * Processes the AST of the given source code to generate a report.
 *
 * @param {string} code - The Python source code
 * @param {string} filename - Optional, the filename (defaults to __main__)
 */
Tifa.prototype.processCode = function(code, filename) {
    // Code
    this.source = code !== "" ? code.split("\n") : [];
    filename = filename || '__main__';
    
    // Attempt parsing - might fail!
    var parse, ast;
    try {
        parse = Sk.parse(filename, code);
        ast = Sk.astFromParse(parse.cst, filename, parse.flags);
    } catch (error) {
        this.report = {"success": false, 
                       "error": error,
                       "issues": {},
                       "variables": {}};
        return this.report;
    }
    try {
        return this.processAst(ast);
    } catch (error) {
        this.report = {"success": false, 
                       "error": error,
                       "issues": {},
                       "variables": {}};
        return this.report;
    }
}

/**
 * Given an AST, actually performs the type and flow analyses to return a
 *  report.
 *
 * @constructor
 * @this {BlockPyEditor}
 * @param {Object} main - The main BlockPy instance
 * @param {HTMLElement} tag - The HTML object this is attached to.
 */
Tifa.prototype.processAst = function(ast) {
    // Unique Global IDs
    this.PathId = 0;
    this.ScopeId = 0;
    this.AstId = 0;
    
    // Human readable names
    this.pathNames = ['*Module'];
    this.scopeNames = ['*Module'];
    this.astNames = [];
    
    // Complete record of all Names
    this.scopeChain = [this.ScopeId];
    this.pathChain = [this.PathId];
    this.nameMap = {};
    this.nameMap[this.PathId] = {};
    
    // Initialize a new, empty report
    this.initializeReport();
    
    // Traverse every node
    this.visit(ast);
    this.report.variables = this.nameMap;
    
    // Check afterwards
    this.finishScope();
    
    return this.report;
}

Tifa.prototype.initializeReport = function() {
    this.report= {
        success: true,
        variables: {},
        issues: {
            "Parser Failure": [], // Complete failure to parse the code
            "Unconnected blocks": [], // Any names with ____
            "Empty Body": [], // Any use of pass on its own
            "Unnecessary Pass": [], // Any use of pass
            "Unread variables": [], // A variable was not read after it was defined
            "Undefined variables": [], // A variable was read before it was defined
            "Possibly undefined variables": [], // A variable was read but was not defined in every branch
            "Overwritten variables": [], // A written variable was written to again before being read
            "Append to non-list": [], // Attempted to use the append method on a non-list
            "Used iteration list": [], // 
            "Unused iteration variable": [], // 
            "Non-list iterations": [], // 
            "Empty iterations": [], // 
            "Type changes": [], // 
            "Iteration variable is iteration list": [], // 
            "Unknown functions": [], // 
            "Not a function": [], // Attempt to call non-function as function
            "Incompatible types": [], // 
            "Return outside function": [], // 
            "Read out of scope": [], // 
            "Write out of scope": [], // Attempted to modify a variable in a higher scope
            "Aliased built-in": [], // 
            "Method not in Type": [] // A method was used that didn't exist for that type
        }
    }
    return this.report;
}
Tifa.prototype.reportIssue = function(issue, data) {
    this.report.issues[issue].push(data)
}
 
/*
https://github.com/python/typeshed/blob/master/stdlib/3/builtins.pyi
List
    append
    index
    

*/

/*
Important concepts:
    
    Assign
    AugAssign
    Import
    With
    
    Attribute lookup
    
    Scope:
        ID
    CallStack:

    Functions
    Lambdas
    
    Return/yield
    
    Ifs/While : Branch
    
    For loops
    
    Classes
    Try/except
    Break/continue
    
    PathId: int
    AstId: int
    ScopeId: int
    
    NameMap
        0 (top) =>
        bid => 
            fully-scoped-name: State
    State:
        name: str
        type: Type
        set, read, overwrite: str {yes, no, maybe}
        trace: list of TraceNode
    TraceNode:
        type: Type
        set, read, overwrite: str {yes, no, maybe}
    Type:
        ast: str {Unknown, Num, Str, List, Tuple, Set, Dict, Bool, None}
        empty?: boolean
        literals?: boolean
        subtype?: Type
        keys?: Type
        values?: Type
        subtypes?: list of Type
        definition?: JS function object
    Report:
        success: bool
        issues: Issue => list of IssueData
        variables: State
    IssueData: 
        name?: str
        scope?: str
        position?: int
        type?: Type
*/

Tifa.prototype.visit = function(node) {
    this.astNames.push(node._astname);
    this.AstId += 1;
    var result = NodeVisitor.prototype.visit.call(this, node);
    this.AstId -= 1;
    this.astNames.pop();
    if (result === undefined) {
        return Tifa._UNKNOWN_TYPE();
    } else {
        return result;
    }
}

Tifa.prototype.visit_Assign = function(node) {
    // Handle value
    var valueType = this.visit(node.value);
    // Handle targets
    this.visitList(node.targets);
    var position = Tifa.locate(node);
    var that = this;
    this.walkTargets(node.targets, valueType, (function action(target, type) {
        if (target._astname === 'Name') {
            that.storeVariable(target.id.v, type, position);
        } else if (target._astname == 'Tuple' || target._astname == 'List') {
            for (var i = 0, len = target.elts.length; i < len; i++) {
                var elt = target.elts[i];
                var eltType = Tifa.indexSequenceType(type, i);
                action(elt, eltType);
            }
        }
    }));
    
}

Tifa.prototype.visit_BinOp = function(node) {
    // Handle left and right
    var left = this.visit(node.left);
    var right = this.visit(node.right);
    
    // Handle operation
    var opLookup = Tifa.VALID_BINOP_TYPES[node.op.name];
    if (opLookup) {
        opLookup = opLookup[left.name];
        if (opLookup) {
            opLookup = opLookup[right.name];
            if (opLookup) {
                return opLookup(left, right);
            }
        }
    }
    this.reportIssue("Incompatible types", 
                     {"left": left, "right": right, 
                      "operation": node.op.name, 
                      "position": Tifa.locate(node)});
    return Tifa._UNKNOWN_TYPE;
}

Tifa.prototype.visit_Call = function(node) {
    // Handle func part (Name or Attribute)
    var functionType = this.visit(node.func);
    // Handle args
    var arguments = [];
    for (var i = 0, len = node.args.length; i < len; i++) {
        var arg = this.visit(node.args[i]);
        arguments.push(arg);
    }
    // Handle keywords
    // Handle starargs
    // Handle kwargs
    if (functionType.name == 'Function') {
        return functionType.definition(functionType, arguments);
    }
    this.reportIssue("Not a function", {"position": Tifa.locate(node)});
    return Tifa._UNKNOWN_TYPE;
}

Tifa.prototype.visit_If = function(node) {
    // Visit the conditional
    this.visit(node.test);
    
    // Visit the bodies
    var thisPathId = this.PathId;
    this.PathId += 1;
    var ifPathId = this.PathId;
    this.pathNames.push(ifPathId+'i');
    this.pathChain.unshift(ifPathId);
    this.nameMap[ifPathId] = {};
    for (var i = 0, len = node.body.length; i < len; i++) {
        this.visit(node.body[i]);
    }
    this.pathNames.pop()
    this.pathChain.shift();
    
    this.PathId += 1;
    var elsePathId = this.PathId;
    this.pathNames.push(elsePathId+'e');
    this.pathChain.unshift(elsePathId);
    this.nameMap[elsePathId] = {};
    for (var i = 0, len = node.orelse.length; i < len; i++) {
        this.visit(node.orelse[i]);
    }
    this.pathNames.pop()
    this.pathChain.shift();
    
    // Combine two paths into one
    for (var ifName in this.nameMap[ifPathId]) {
        if (ifName in this.nameMap[elsePathId]) {
            var combined = Tifa.combineStates(this.nameMap[ifPathId][ifName],
                                              this.nameMap[elsePathId][ifName],
                                              Tifa.locate(node))
        } else {
            var combined = Tifa.combineStates(this.nameMap[ifPathId][ifName], null, Tifa.locate(node))
        }
        this.nameMap[thisPathId][ifName] = combined;
    }
    for (var elseName in this.nameMap[elsePathId]) {
        if (!(ifName in this.nameMap[elsePathId])) {
            var combined = Tifa.combineStates(this.nameMap[elsePathId][elseName], 
                                              null,
                                              Tifa.locate(node))
            this.nameMap[thisPathId][elseName] = combined;
        }
    }
}

Tifa.prototype.visit_While = function(node) {
    this.visit_If(node);
    // This probably doesn't work for orelse bodies, but who actually uses those.
}

Tifa.prototype.visit_For = function(node) {
    // Handle the iteration list
    var position = Tifa.locate(node);
    var iter = node.iter;
    var iterType;
    var iterListName = null;
    if (iter._astname === "Name") {
        iterListName = iter.id.v;
        if (iterListName == "___") {
            this.reportIssue("Unconnected blocks", {"position": position})
        }
        var state = this.iterateVariable(iterListName, Tifa.locate(node));
        iterType = state.type;
    } else {
        iterType = this.visit(iter);
    }
    if (Tifa.isTypeEmptyList(iterType)) {
        this.reportIssue("Empty iterations", {"position": position});
    }
    if (!(Tifa.isTypeSequence(iterType))) {
        this.reportIssue("Non-list iterations", {"position": position});
    }
    var iterSubtype = null;
    if (iterType !== null) {
        iterSubtype = Tifa.indexSequenceType(iterType, 0);
    }
    
    // Handle the iteration variable
    var iterVariableName = null;
    var that = this;
    (function walkTarget(target, type) {
        if (target._astname === 'Name') {
            if (iterVariableName == null) {
                iterVariableName = target.id.v;
            }
            that.storeIterVariable(target.id.v, type, position);
        } else if (target._astname == 'Tuple' || target._astname == 'List') {
            for (var i = 0, len = target.elts.length; i < len; i++) {
                var elt = target.elts[i];
                var eltType = Tifa.indexSequenceType(type, i);
                walkTarget(elt, eltType, position);
            }
        }
    })(node.target, iterType);
    
    if (iterVariableName && iterListName && iterListName == iterVariableName) {
        this.reportIssue("Iteration variable is iteration list", 
                         {"name": iterVariableName, "position": position});
    }

    // Handle the bodies
    for (var i = 0, len = node.body.length; i < len; i++) {
        this.visit(node.body[i]);
    }
    for (var i = 0, len = node.orelse.length; i < len; i++) {
        this.visit(node.orelse[i]);
    }
}

Tifa.prototype.visit_FunctionDef = function(node) {
    // Name
    var functionName = node.name.v;
    var position = Tifa.locate(node);
    var state = this.storeVariable(functionName, {"type": "Function"}, position);
    var that = this;
    state.type.definition = function(parameters) {
        // Manage scope
        that.ScopeId += 1;
        that.scopeChain.unshift(that.ScopeId);
        // Process arguments
        var args = node.args.args;
        for (var i = 0; i < args.length; i++) {
            var arg = args[i];
            var name = Sk.ffi.remapToJs(arg.id);
            var parameter = Tifa.copyType(parameters[i]);
            that.storeVariable(name, parameter, position)
        }
        for (var i = 0, len = node.body.length; i < len; i++) {
            that.visit(node.body[i]);
        }
        // Return scope
        that.finishScope();
        that.scopeChain.shift();
    }
    return state.type;
}

Tifa.prototype.visit_Name = function(node) {
    var name = node.id.v;
    if (name == "___") {
        this.reportIssue("Unconnected blocks", {"position": Tifa.locate(node)})
    }
    if (node.ctx.prototype._astname === "Load") {
        if (name == "True" || name == "False") {
            return Tifa._BOOL_TYPE();
        } else if (name == "None") {
            return Tifa._NONE_TYPE();
        } else {
            var state = this.loadVariable(name, Tifa.locate(node));
            return state.type;
        }
    } else {
        var variable = this.findVariablesScope(name);
        if (variable.exists) {
            return variable.state.type;
        } else {
            return Tifa._UNKNOWN_TYPE();
        }
    }
}


Tifa.prototype.visit_Num = function(node) {
    return Tifa._NUM_TYPE();
}
Tifa.prototype.visit_Bool = function(node) {
    return Tifa._BOOL_TYPE();
}
Tifa.prototype.visit_Str = function(node) {
    return Tifa._STR_TYPE();
}
Tifa.prototype.visit_List = function(node) {
    var type = Tifa._LIST_TYPE();
    if (node.elts.length == 0) {
        type.empty = true;
    } else {
        type.empty = false;
        // TODO: confirm homogenous subtype
        for (var i = 0, len = node.elts.length; i < len; i++) {
            type.subtype = this.visit(node.elts[i]);
        }
    }
    return type;
}
Tifa.prototype.visit_Tuple = function(node) {
    var type = Tifa._TUPLE_TYPE();
    if (node.elts.length == 0) {
        type.empty = true;
    } else {
        type.empty = false;
        type.subtypes = [];
        // TODO: confirm homogenous subtype
        for (var i = 0, len = node.elts.length; i < len; i++) {
            type.subtypes.push(this.visit(node.elts[i]));
        }
    }
    return type;
}


Tifa.prototype.findVariablesScope = function (name) {
    for (var j = 0, len = this.scopeChain.length; j < len; j++) {
        for (var i = 0, len = this.pathChain.length; i < len; i++) {
            var pathId = this.pathChain[i];
            var path = this.nameMap[pathId];
            var fullName = this.scopeChain.slice(j).join("/") + "/" + name;
            if (fullName in path) {
                if (j == 0) {
                    return {'exists': true, 'inScope': true, 'state': path[fullName]};
                } else {
                    return {'exists': true, 'inScope': false, 'state': path[fullName]};
                }
            }
        }
    }
    return {'exists': false};
}

Tifa.prototype.storeVariable = function(name, type, position) {
    var fullName = this.scopeChain.join("/") + "/" + name;
    var currentPath = this.pathChain[0];
    var variable = this.findVariablesScope(name);
    if (!variable.exists) {
        // Create a new instance of the variable on the current path
        state = {'name': name, 'trace': [], 'type': type,
                 'read': 'no', 'set': 'yes', 'over': 'no'};
        this.nameMap[currentPath][fullName] = state;
    } else {
        Tifa.traceState(variable.state, "store");
        if (!variable.inScope) {
            this.reportIssue("Write out of scope", 
                             {'name': name, 'position':position})
        }
        // Type change?
        if (!Tifa.areTypesEqual(type, state.type)) {
            this.reportIssue("Type changes", 
                             {'name': name, 'position':position,
                              'old': state.type, 'new': type})
        }
        state.type = type;
        // Overwritten?
        if (state.set == 'yes' && state.read == 'no') {
            state.over = 'yes';
        } else {
            state.set = 'yes';
            state.read = 'no';
        }
        this.nameMap[currentPath][fullName] = state;
    }
    return state;
}

Tifa.prototype.storeIterVariable = function(name, type, position) {
    var state = this.storeVariable(name, type, position);
    state.read = 'yes';
    return state;
}

Tifa.prototype.loadVariable = function(name, position) {
    var fullName = this.scopeChain.join("/") + "/" + name;
    var currentPath = this.pathChain[0];
    var variable = this.findVariablesScope(name);
    if (!variable.exists) {
        // Create a new instance of the variable on the current path
        state = {'name': name, 'trace': [], 'type': '*Unknown',
                 'read': 'yes', 'set': 'no', 'over': 'no'};
        this.nameMap[currentPath][fullName] = state;
        this.reportIssue("Undefined variables", 
                         {'name': name, 'position':position})
        return state;
    } else {
        Tifa.traceState(variable.state, "load");
        if (variable.state.set == 'no') {
            this.reportIssue("Undefined variables", 
                             {'name': name, 'position':position})
        }
        if (variable.state.set == 'maybe') {
            this.reportIssue("Possibly undefined variables", 
                             {'name': name, 'position':position})
        }
        variable.state.read = 'yes';
        this.nameMap[currentPath][fullName] = variable.state;
        return variable.state;
    }
}

Tifa.prototype.iterateVariable = function(name, position) {
    return this.loadVariable(name, position);
}

Tifa.prototype.finishScope = function() {
    var pathId = this.pathChain[0];
    //console.log("Finishing Scope", this.scopeChain, "on path", pathId, "; variables:", this.nameMap);
    for (var name in this.nameMap[pathId]) {
        if (Tifa.sameScope(name, this.scopeChain)) {
            var state = this.nameMap[pathId][name];
            if (state.over == 'yes') {
                this.reportIssue('Overwritten variables', 
                                 {'name': state.name, 'position': 0}) // TODO position
            }
            if (state.read == 'no') {
                this.reportIssue('Unread variables', 
                                 {'name': state.name})
            }
        }
    }
}

Tifa.prototype.walkTargets = function(targets, type, walker) {
    for (var i = 0, len = targets.length; i < len; i++) {
        walker(targets[i], type);
    }
}

Tifa._BOOL_TYPE = function() { return {'name': 'Bool'} };
Tifa._NUM_TYPE = function() { return {'name': 'Num'} };
Tifa._STR_TYPE = function() { return {'name': 'Str'} };
Tifa._SET_TYPE = function() { return {'name': 'Str', "empty": false} };
Tifa._LIST_TYPE = function() { return {'name': 'List', "empty": false} };
Tifa._TUPLE_TYPE = function() { return {'name': 'Tuple'} };
Tifa._NONE_TYPE = function() { return {'name': 'None'} };
Tifa._UNKNOWN_TYPE = function() { return {'name': '*Unknown'} };
Tifa.VALID_BINOP_TYPES = {
    'Add': {'Num': {'Num': Tifa._NUM_TYPE}, 
            'String' :{'String': Tifa._STR_TYPE}, 
            'List': {'List': Tifa.mergeTypes},
            'Tuple': {'Tuple': Tifa.mergeTypes}},
    'Sub': {'Num': {'Num': Tifa._NUM_TYPE}, 
            'Set': {'Set': Tifa.mergeTypes}},
    'Div': {'Num': {'Num': Tifa._NUM_TYPE}},
    'Mult': {'Num': {'Num': Tifa._NUM_TYPE, 
                     'Str': Tifa._STR_TYPE, 
                     'List': (l, r) => r, 
                     'Tuple': (l, r) => r},
             'Str': {'Num': Tifa._STR_TYPE},
             'List': {'Num': (l, r) => l},
             'Tuple': {'Num': (l, r) => l}},
    'Pow': {'Num': {'Num': Tifa._NUM_TYPE}},
    // Should we allow old-fashioned string interpolation?
    // Currently, I vote no because it makes the code harder and is bad form.
    'Mod': {'Num': {'Num': Tifa._NUM_TYPE}},
}

Tifa.locate = function(node) {
    return {"column": node.col_offset, "line": node.lineno};
}

Tifa.indexSequenceType= function(type, i) {
    if (type.name == "Tuple") {
        return type.subtypes[i];
    } else if (type.name == "List") {
        return type.subtype;
    } else if (type.name == "Str") {
        return {"name": 'Str'}
    }
}

Tifa.areTypesEqual = function(left, right) {
    if (left === null || right === null) {
        return false;
    } else if (left.name === "Unknown" || right.type === "Unknown") {
        return false;
    } else if (left.name === "List" && right.name === "List") {
        if (left.empty || right.empty) {
            return true;
        } else {
            return Tifa.areTypesEqual(left.subtype, right.subtype);
        }
    } else {
        return left.name == right.name;
    }
}

Tifa.isTypeEmptyList = function(type) {
    return (type.name === "List" && type.empty);
}
Tifa.isTypeSequence = function(type) {
    return arrayContains(type.name, ["List", "Set", "Tuple", "Str", "File"]);
}

Tifa.sameScope = function(fullName, scopeChain) {
    var nameScopes = fullName.split("/").slice(0, -1);
    var checkingScopes = scopeChain.reverse();
    if (nameScopes.length != checkingScopes.length) {
        return false;
    }
    for (var i = 0, len = checkingScopes.length; i < len; i++) {
        if (nameScopes[i] != checkingScopes[i]) {
            return false;
        }
    }
    return true;
}

Tifa.combineStates = function(left, right, position) {
    var state = {'name': left.name, 'trace': left.trace, 'type': left.type,
                 'read': left.read, 'set': left.set, 'over': left.over};
    if (right == null) {
        state.read = left.read == 'no' ? 'no' : 'maybe';
        state.set = left.set == 'no' ? 'no' : 'maybe';
        state.over = left.over == 'no' ? 'no' : 'maybe';
    } else {
        if (!Tifa.areTypesEqual(left.type, right.type)) {
            this.reportIssue("Type changes", 
                             {'name': left.name, 'position':position,
                             'old': left.type, 'new': right.type})
        }
        state.read = Tifa.matchRSO(left.read, right.read);
        state.set = Tifa.matchRSO(left.set, right.set);
        state.over = Tifa.matchRSO(left.over, right.over);
    }
    return state;
}

Tifa.matchRSO = function(left, right) {
    if (left == right) {
        return left;
    } else {
        return "maybe";
    }
}

Tifa.traceState = function(state, method) {
    state.trace.push({
        'type': state.type, 'method': method,
        'set': state.set, 'read': state.read, 'over': state.over
    })
}

/**
 * Correctly clones a type, returning mutable types unchanged.
 */
Tifa.copyType = function(type) {
    switch (type.name) {
        // Immutable types:
        case "Str": return Tifa._STR_TYPE();
        case "Num": return Tifa._NUM_TYPE();
        case "Tuple": return Tifa._TUPLE_TYPE();
        // Mutable types:
        default: return type;
    }
}

Tifa.mergeTypes = function(left, right) {
    // TODO: Check that lists/sets have the same subtypes
    switch (left.name) {
        case "List": return (left.empty ? right.subtype : left.subtype);
        case "Set": return (left.empty ? right.subtype : left.subtype);
        case "Tuple": return left.subtypes.concat(right.subtypes);
    }
}