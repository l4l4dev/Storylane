/**
 * The drizzle handle behind a ProjectTx is an escape hatch: with it a route can query any
 * table in any project. Keep it in src/db (the helpers) and src/services (the code that
 * runs inside a transaction); routes must call a service instead. The eslint config, not
 * this rule, decides which directories are exempt.
 *
 * Syntactic only: it catches the spellings that reach the handle directly (`ptx.tx`,
 * `ptx["tx"]`, `ptx[`tx`]`, `const { tx } = ptx`). A helper that returns the handle from an
 * exempt directory is out of its reach — the no-restricted-imports rule in eslint.config.js
 * covers the other half by keeping the raw client out of routes and services.
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
    /** The static string a computed key evaluates to, or undefined when it is dynamic. */
    const staticKey = (node) => {
      if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
      if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
        return node.quasis[0].value.cooked;
      }
      return undefined;
    };
    const isTxKey = (node) =>
      node.computed ? staticKey(node.property) === "tx" : node.property.type === "Identifier" && node.property.name === "tx";
    return {
      MemberExpression(node) {
        if (!isTxKey(node)) return;
        if (node.object.type === "ThisExpression") return; // the ProjectTx class's own getter
        context.report({ node, messageId: "noEscape" });
      },
      // `const { tx } = ptx` / `({ tx: raw })` / a destructuring parameter reach the handle
      // without ever spelling a member access.
      ObjectPattern(node) {
        for (const prop of node.properties) {
          if (prop.type !== "Property") continue;
          const name = prop.computed
            ? staticKey(prop.key)
            : prop.key.type === "Identifier"
              ? prop.key.name
              : staticKey(prop.key);
          if (name === "tx") context.report({ node: prop, messageId: "noEscape" });
        }
      },
    };
  },
};
