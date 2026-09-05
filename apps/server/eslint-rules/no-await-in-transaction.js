const MEMBER_ONLY = new Set(["transaction"]);
const ANY_CALLEE = new Set(["withProject", "withTwoProjects"]);

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "bun:sqlite transactions are synchronous; an await inside db.transaction(), withProject() or withTwoProjects() silently breaks atomicity",
    },
    schema: [],
    messages: {
      noAwait:
        "Do not await inside a db.transaction() / withProject() / withTwoProjects() callback (bun:sqlite transactions are synchronous).",
    },
  },
  create(context) {
    const stack = [];
    const isTransactionCall = (node) => {
      if (node.type !== "CallExpression") return false;
      const callee = node.callee;
      if (callee.type === "Identifier") return ANY_CALLEE.has(callee.name);
      if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
        return MEMBER_ONLY.has(callee.property.name) || ANY_CALLEE.has(callee.property.name);
      }
      return false;
    };
    const enterFn = (node) => {
      stack.push(Boolean(node.parent && isTransactionCall(node.parent)));
    };
    const exitFn = () => {
      stack.pop();
    };
    return {
      ArrowFunctionExpression: enterFn,
      "ArrowFunctionExpression:exit": exitFn,
      FunctionExpression: enterFn,
      "FunctionExpression:exit": exitFn,
      FunctionDeclaration: enterFn,
      "FunctionDeclaration:exit": exitFn,
      AwaitExpression(node) {
        if (stack.length && stack[stack.length - 1]) context.report({ node, messageId: "noAwait" });
      },
    };
  },
};
