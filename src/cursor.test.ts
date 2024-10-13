import type { ParserGenerator } from "./parser.ts";

import { Cursor, ParserWithCursorTracking } from "./cursor.ts";
import { assertEquals } from "jsr:@std/assert";


Deno.test("Cursor.fromTagFunctionCall", () => {
    const tmp = (_: TemplateStringsArray) => Cursor.fromTagFunctionCall(tmp);
    assertEquals(tmp``.toString(), `${import.meta.url}:9:22`);
});

Deno.test("ParserWithCursorTracking", () => {
    const parser = new class extends ParserWithCursorTracking<[ Cursor, string, Cursor ]> {
        * parse(): ParserGenerator<string, [ Cursor, string, Cursor ]> {
            return [ this.cursor, yield* this.consume(), this.cursor ];
        }
    }(new Cursor(new URL(import.meta.url)));

    const result = Array.from(parser.process(`AB\nC`));

    assertEquals(result[0][0].toString(), `${import.meta.url}:1:1`);
    assertEquals(result[0][1], "A");
    assertEquals(result[0][2].toString(), `${import.meta.url}:1:2`);

    assertEquals(result[1][0].toString(), `${import.meta.url}:1:2`);
    assertEquals(result[1][1], "B");
    assertEquals(result[1][2].toString(), `${import.meta.url}:1:3`);

    assertEquals(result[2][0].toString(), `${import.meta.url}:1:3`);
    assertEquals(result[2][1], "\n");
    assertEquals(result[2][2].toString(), `${import.meta.url}:2:1`);

    assertEquals(result[3][0].toString(), `${import.meta.url}:2:1`);
    assertEquals(result[3][1], "C");
    assertEquals(result[3][2].toString(), `${import.meta.url}:2:2`);
});
