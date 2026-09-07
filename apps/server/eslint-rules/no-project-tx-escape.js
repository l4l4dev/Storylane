/**
 * The drizzle handle behind a ProjectTx is an escape hatch: with it a route can query any
 * table in any project. Keep it in src/db (the helpers) and src/services (the code that
 * runs inside a transaction); routes must call a service instead. The eslint config, not
 * this rule, decides which directories are exempt.
 * @type {import("eslint").Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: { description: "no direct access to a ProjectTx's drizzle handle outside src/db and src/services" },
    schema: [],
    messages: {
      noEscape: "Do not reach for `.tx` here — call a service in src/services that takes the ProjectTx.",
    },
  },
  create(context) {
    const isTxKey = (node) =>
      (!node.computed && node.property.type === "Identifier" && node.property.name === "tx") ||
      (node.computed && node.property.type === "Literal" && node.property.value === "tx");
    return {
      MemberExpression(node) {
        if (!isTxKey(node)) return;
        if (node.object.type === "ThisExpression") return; // the ProjectTx class's own getter
        context.report({ node, messageId: "noEscape" });
      },
    };
  },
};
