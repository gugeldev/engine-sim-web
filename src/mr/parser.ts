/**
 * Parser for the subset of the Piranha language (.mr) used by engine-sim
 * scripts: node definitions, instantiations, member access, method chaining
 * and arithmetic.
 */

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "name"; name: string; line: number }
  | { kind: "unary"; op: "-"; arg: Expr }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { kind: "member"; object: Expr; name: string; line: number }
  /** `f(args)` instantiates node type f; `obj.f(args)` does the same with `this: obj`. */
  | { kind: "call"; callee: string; self: Expr | null; args: Arg[]; line: number };

export type Arg = { name: string | null; value: Expr };

export type Port = {
  kind: "input" | "output" | "alias";
  name: string;
  value: Expr | null;
};

export type Statement =
  | { kind: "instance"; type: string; name: string; args: Arg[]; line: number }
  | { kind: "expr"; expr: Expr };

export type NodeDef = {
  name: string;
  builtin: string | null;
  ports: Port[];
  body: Statement[];
  file: string;
};

export type Module = {
  file: string;
  imports: string[];
  nodes: NodeDef[];
  statements: Statement[];
};

type Token = { type: "id" | "num" | "str" | "op" | "eof"; value: string; line: number };

export class MrSyntaxError extends Error {
  constructor(message: string, file: string, line: number) {
    super(`${file}:${line}: ${message}`);
  }
}

function tokenize(source: string, file: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const ops = [
    "=>",
    "::",
    "(",
    ")",
    "{",
    "}",
    "[",
    "]",
    ",",
    ":",
    ";",
    ".",
    "+",
    "-",
    "*",
    "/",
    "@",
  ];

  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (source.startsWith("//", i)) {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (let k = i; k < stop; k++) if (source[k] === "\n") line++;
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "\\" && j + 1 < source.length) {
          value += source[j + 1];
          j += 2;
        } else {
          if (source[j] === "\n") line++;
          value += source[j++];
        }
      }
      tokens.push({ type: "str", value, line });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const m = /^(0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/.exec(source.slice(i));
      if (!m) throw new MrSyntaxError(`bad number`, file, line);
      tokens.push({ type: "num", value: m[0], line });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      tokens.push({ type: "id", value: m?.[0] ?? c, line });
      i += m?.[0].length ?? 1;
    } else {
      const op = ops.find((o) => source.startsWith(o, i));
      if (!op) throw new MrSyntaxError(`unexpected character '${c}'`, file, line);
      tokens.push({ type: "op", value: op, line });
      i += op.length;
    }
  }
  tokens.push({ type: "eof", value: "", line });
  return tokens;
}

export function parse(source: string, file: string): Module {
  const tokens = tokenize(source, file);
  let p = 0;

  const peek = (o = 0) => tokens[Math.min(p + o, tokens.length - 1)];
  const next = () => tokens[p++];
  const is = (value: string, o = 0) => {
    const t = peek(o);
    return (t.type === "op" || t.type === "id") && t.value === value;
  };
  const accept = (value: string) => {
    if (is(value)) {
      p++;
      return true;
    }
    return false;
  };
  const expect = (value: string) => {
    if (!accept(value)) {
      throw new MrSyntaxError(`expected '${value}' but found '${peek().value}'`, file, peek().line);
    }
  };
  const ident = () => {
    const t = next();
    if (t.type !== "id")
      throw new MrSyntaxError(`expected identifier, found '${t.value}'`, file, t.line);
    return t.value;
  };

  const skipBalanced = (open: string, close: string) => {
    expect(open);
    let depth = 1;
    while (depth > 0) {
      const t = next();
      if (t.type === "eof") throw new MrSyntaxError(`unterminated '${open}'`, file, t.line);
      if (t.type === "op" && t.value === open) depth++;
      if (t.type === "op" && t.value === close) depth--;
    }
  };

  /** `@name: "doc" "more doc"` annotations are ignored. */
  const skipAnnotations = () => {
    while (is("@")) {
      next();
      ident();
      expect(":");
      while (peek().type === "str") next();
    }
  };

  const args = (): Arg[] => {
    const list: Arg[] = [];
    expect("(");
    while (!is(")")) {
      if (peek().type === "id" && is(":", 1)) {
        const name = ident();
        expect(":");
        list.push({ name, value: expr() });
      } else {
        list.push({ name: null, value: expr() });
      }
      if (!accept(",")) break;
    }
    expect(")");
    return list;
  };

  const primary = (): Expr => {
    const t = peek();
    if (t.type === "num") {
      next();
      return { kind: "num", value: Number(t.value) };
    }
    if (t.type === "str") {
      next();
      let value = t.value;
      while (peek().type === "str") value += next().value;
      return { kind: "str", value };
    }
    if (accept("(")) {
      const e = expr();
      expect(")");
      return e;
    }
    if (accept("-")) return { kind: "unary", op: "-", arg: postfix() };
    if (t.type === "id") {
      next();
      if (t.value === "true" || t.value === "false")
        return { kind: "bool", value: t.value === "true" };
      if (is("(")) return { kind: "call", callee: t.value, self: null, args: args(), line: t.line };
      return { kind: "name", name: t.value, line: t.line };
    }
    throw new MrSyntaxError(`unexpected '${t.value}'`, file, t.line);
  };

  const postfix = (): Expr => {
    let e = primary();
    while (is(".")) {
      next();
      const t = peek();
      const name = ident();
      if (is("(")) e = { kind: "call", callee: name, self: e, args: args(), line: t.line };
      else e = { kind: "member", object: e, name, line: t.line };
    }
    return e;
  };

  const term = (): Expr => {
    let e = postfix();
    while (is("*") || is("/")) {
      const op = next().value as "*" | "/";
      e = { kind: "binary", op, left: e, right: postfix() };
    }
    return e;
  };

  const expr = (): Expr => {
    let e = term();
    while (is("+") || is("-")) {
      const op = next().value as "+" | "-";
      e = { kind: "binary", op, left: e, right: term() };
    }
    return e;
  };

  /** Statements that may appear at file level or inside node bodies. */
  const statement = (): Statement => {
    // `type name(args)` instantiation
    if (peek().type === "id" && peek(1).type === "id" && is("(", 2)) {
      const line = peek().line;
      const type = ident();
      const name = ident();
      const a = args();
      accept(";");
      return { kind: "instance", type, name, args: a, line };
    }
    const e = expr();
    accept(";");
    return { kind: "expr", expr: e };
  };

  const nodeDef = (): NodeDef => {
    accept("inline");
    expect("node");
    const name = ident();
    let builtin: string | null = null;
    if (accept("=>")) builtin = ident();
    expect("{");
    const ports: Port[] = [];
    const body: Statement[] = [];
    while (!accept("}")) {
      skipAnnotations();
      if (is("}")) continue;
      if (is("input") || is("output") || (is("alias") && is("output", 1))) {
        let kind: Port["kind"] = next().value === "input" ? "input" : "output";
        if (kind === "output" && tokens[p - 1].value === "alias") {
          next();
          kind = "alias";
        }
        const portName = ident();
        if (is("[")) skipBalanced("[", "]");
        let value: Expr | null = null;
        if (accept(":")) value = expr();
        accept(";");
        ports.push({ kind, name: portName, value });
      } else {
        body.push(statement());
      }
    }
    return { name, builtin, ports, body, file };
  };

  const module: Module = { file, imports: [], nodes: [], statements: [] };
  while (peek().type !== "eof") {
    skipAnnotations();
    if (peek().type === "eof") break;
    if (is("module") && is("{", 1)) {
      next();
      skipBalanced("{", "}");
      continue;
    }
    accept("public");
    accept("private");
    if (accept("import")) {
      const t = next();
      if (t.type !== "str") throw new MrSyntaxError("expected import path", file, t.line);
      module.imports.push(t.value);
    } else if (is("node") || (is("inline") && is("node", 1))) {
      module.nodes.push(nodeDef());
    } else {
      module.statements.push(statement());
    }
  }
  return module;
}
