import { EndOfInputError, Parser, type ParserGenerator } from "./parser.ts";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";

Deno.test("Parser", () => {
    const parser = new class extends Parser<string, void> {
        * parse(): ParserGenerator<string, void> {
            assertEquals(yield* this.peek(), yield* this.consume());
            assertEquals(yield* this.consume(), "B");

            const snapshot = yield* this.snapshot();
            assertEquals(yield* this.consume(), "\n");
            assertEquals(yield* this.consume(), "C");

            try {
                yield* this.peek();
                throw undefined;
            } catch (error) {
                assertInstanceOf(error, EndOfInputError);
            }

            try {
                yield* this.consume();
                throw undefined;
            } catch (error) {
                assertInstanceOf(error, EndOfInputError);
            }

            yield snapshot;
            assertEquals(yield* this.consume(), "\n");
            assertEquals(yield* this.consume(), "C");
        }
    }();

    assertEquals([
        ...parser.process(`AB\nC`, {stream: true}),
        ...parser.process(``, {stream: false})
    ], [ undefined ]);
});
