import YAML from "yaml";

/**
 * YAML as a law file is read (ADR-0047 §1): the 1.2 core schema, so `no` and `on` stay strings; unique keys;
 * no aliases or anchors, so the file a reviewer reads is the data the CLI sees. Parse errors throw with the
 * parser's message.
 */
export function parseStrictYaml(text: string): unknown {
  const doc = YAML.parseDocument(text, { schema: "core", uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length > 0) throw new Error(doc.errors.map((e) => e.message.trim()).join("; "));
  let alias = false;
  YAML.visit(doc, {
    Alias() {
      alias = true;
      return YAML.visit.BREAK;
    },
  });
  if (alias) throw new Error("YAML aliases and anchors are not allowed in a law file");
  return doc.toJS();
}
