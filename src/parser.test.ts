import { EndOfInput, eatInput, Parser, peekInput, createSnapshot, ParserStream } from "./parser.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { ParserGenerator } from "./parser.ts";

Deno.test("Parses and returns each character from the input string", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, string | EndOfInput> {
            return yield* eatInput();
        },
    });

    assertEquals(
        [ ...parser.parse("ABC") ],
        [ "A", "B", "C" ],
    );
});

Deno.test("Parses and returns each character from the input string twice using peek and eat", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, Array<string | EndOfInput>> {
            return [
                yield* peekInput(),
                yield* eatInput(),
            ];
        },
    });

    assertEquals(
        [ ...parser.parse("ABC") ].flat(),
        [ "A", "A", "B", "B", "C", "C" ],
    );
});

Deno.test("Parses input and returns characters followed by EndOfInput when input is exhausted", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, Array<string | EndOfInput>> {
            return [
                yield* eatInput(),
                yield* eatInput(),
            ];
        },
    });

    assertEquals(
        [ ...parser.parse("ABC") ].flat(),
        [ "A", "B", "C", EndOfInput ],
    );
});

Deno.test("Throws an error when attempting to parse without consuming any input", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, string | EndOfInput> {
            return yield* peekInput();
        },
    });

    assertThrows(() => [ ...parser.parse("ABC") ]);
});

Deno.test("Throws an error when attempting to parse without consuming input after creating a snapshot", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, Array<string | EndOfInput>> {
            const snapshot = yield* createSnapshot();

            const result: Array<string | EndOfInput> = [
                yield* eatInput(),
                yield* eatInput(),
            ];

            yield snapshot;

            return result;
        },
    });

    assertThrows(() => [ ...parser.parse("ABC") ]);
});

Deno.test("Rolls back to a previous snapshot and verifies input consistency after rollback", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, boolean> {
            const snapshot = yield* createSnapshot();
            const previouslyConsumedInput = yield* eatInput();
            yield snapshot;
            return previouslyConsumedInput === (yield* eatInput());
        },
    });

    assertEquals(
        [ ...parser.parse("ABC") ],
        [ true, true, true ],
    );
});

Deno.test("Parses a stream of characters and returns each character from the stream", async () => {
    assertEquals(
        await Array.fromAsync(
            ReadableStream.from("ABC")
                .pipeThrough(new ParserStream({
                    * [Symbol.iterator](): ParserGenerator<string, string | EndOfInput> {
                        return yield* eatInput();
                    },
                }))
        )
            .then(chunks => chunks.flat()),
        [ "A", "B", "C" ],
    );
});
