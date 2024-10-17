import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
    type ParserGenerator,
    Parser,
    expect,
    match,
    equals,
    choice,
    sequence,
    FatalParserError,
    EndOfInput,
    ParserError, noop,
    ChoiceParserError,
    snapshot,
} from "./mod.ts";

Deno.test("expect with match", () => {
    const parser = new Parser(expect(match(/[0-9]/)));

    assertEquals(parser.first("123"), "1");
});

Deno.test("expect with equals", () => {
    const parser = new Parser(expect(equals("test")));

    assertEquals(parser.first([ "test" ]), "test");
});

Deno.test("unexpected input error", () => {
    const parser = new Parser(expect(equals("test")));
    const input = [ "fail" ];
    assertThrows(() => parser.first(input), ParserError);
});

Deno.test("choice parser", () => {
    const parser = new Parser(
        choice(
            expect(match(/[0-9]/))
                .repeat(1)
                .map(digits => digits.join("")),
            expect(equals("test"))
        )
    );

    assertEquals(parser.first([ "1", "2", "3" ]), "123");
    assertEquals(parser.first([ "test" ]), "test");
});

Deno.test("sequence parser", () => {
    const sequenceParser = new Parser(
        sequence(
            expect(equals("(")),
            expect(match(/[a-z]/))
                .repeat(1)
                .map(chars => chars.join("")),
            expect(equals(")"))
        )
    );

    assertEquals(sequenceParser.first("(abc)"), [ "(", "abc", ")" ]);
});

Deno.test("chainable parser with map", () => {
    const parser = new Parser(
        expect(match(/[0-9]/))
            .map(Number)
            .map(n => n * 2)
    );

    assertEquals(parser.first("4"), 8);
});

Deno.test("noop parser", () => {
    const parser = new Parser(
        expect<string | EndOfInput>(equals(EndOfInput))
            .then(noop("static result")),
    );

    assertEquals(parser.first(""), "static result");
});

Deno.test("fatal parser error", () => {
    const parser = new Parser(
        expect(equals("Test"))
            .fatal(),
    );

    assertThrows(() => parser.first("non-critical"), FatalParserError);
});

Deno.test("parseMany with multiple inputs", () => {
    const parser = new Parser(
        expect(match(/[0-9]/))
            .repeat(1)
            .map(digits => digits.join(""))
    );


    assertEquals([ ...parser.all("1234") ], [ "1234" ]);
});

Deno.test("snapshot functionality", () => {
    const parser = new Parser({
        * [Symbol.iterator](): ParserGenerator<string, string[]> {
            const fallback = yield* snapshot();
            const tmp1 = yield* expect(match(/./)).repeat(1).map(_ => _.join(""));
            yield fallback;
            const tmp2 = yield* expect(match(/./)).repeat(1).map(_ => _.join(""));
            return [ tmp1, tmp2 ];
        }
    });


    assertEquals(Array.from(parser.all("abc123")).flat(), [ "abc123", "abc123" ]);
});

Deno.test("repeat functionality", () => {
    const parser = new Parser(
        expect(match(/[0-9]/))
            .repeat(0)
            .map(digits => digits.join(""))
    );

    assertEquals(parser.first("12"), "12");
    assertEquals(parser.first("1"), "1");
    assertEquals(parser.first(""), "");
});

Deno.test("between functionality", () => {
    const parser = new Parser(
        expect(match(/[a-z]/))
            .repeat(0)
            .map(_ => _.join(""))
            .between(
                expect(equals("(")),
                expect(equals(")"))
            )
            .map(chars => chars.join(""))
    );

    assertEquals(parser.first("(abc)"), "(abc)");
});

Deno.test("choice with multiple failures", () => {
    const parser = new Parser(
        choice(
            expect(equals("foo")),
            expect(equals("bar"))
        )
    );

    assertThrows(() => parser.first("baz"), ChoiceParserError);
});

Deno.test("chainable with catch", () => {
    const parser = new Parser(
        expect(equals("foo"))
            .catch(() => expect(equals("bar")))
    );

    assertEquals(parser.first([ "bar" ]), "bar");
});

Deno.test("flat functionality", () => {
    const parser = new Parser(
        expect(match(/[0-9]/))
            .repeat(1)
            .map(digits => digits.join(""))
    );

    assertEquals(parser.first("123"), "123");
});

Deno.test("streaming mode", () => {
    const parser = new Parser(
        expect(match(/[0-9]/))
            .repeat(1, 2)
            .map(digits => digits.join(""))
    );

    assertEquals([ ...parser.all("123", {stream: true}) ], [ "12" ]);
    assertEquals([ ...parser.all("456", {stream: false}) ], [ "34", "56" ]);
});
