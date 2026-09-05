/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "bun:sqlite transactions are synchronous; an await inside db.transaction() silently breaks atomicity",
    },
    schema: [],
    messages: {
      noAwait: "Do not await inside a db.transaction() callback (bun:sqlite transactions are synchronous).",
    },
  },
  create(context) {
    const stack = [];
    const isTransactionCall = (node) =>
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "transaction";
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
