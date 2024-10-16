import { choice, equals, noop, match, sequence } from "./combinators.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Parser } from "./parser.ts";

Deno.test("Chainable equals parser for exact string match", () => {
    const parser = new Parser(
        equals("A"),
    );

    assertEquals([ ...parser.parse("A") ], [ "A" ]);
    assertThrows(() => [ ...parser.parse("B") ]);
});

Deno.test("Chainable equals parser with map transformations", () => {
    const parser = new Parser(
        equals("A")
            .map(_ => _ + "B")
            .map(_ => _ + "C"),
    );

    assertEquals([ ...parser.parse("A") ], [ "ABC" ]);
});

Deno.test("Chainable match parser with regex pattern", () => {
    const parser = new Parser(
        match(/^A$/m),
    );

    assertEquals([ ...parser.parse("A") ], [ "A" ]);
    assertThrows(() => [ ...parser.parse("B") ]);
});

Deno.test("Chainable match parser with regex and map transformations", () => {
    const parser = new Parser(
        match(/^A$/m)
            .map(_ => _ + "B")
            .map(_ => _ + "C"),
    );

    assertEquals([ ...parser.parse("A") ], [ "ABC" ]);
});

Deno.test("Chainable sequence parser with single match", () => {
    const parser = new Parser(
        sequence(
            match(/^A$/m),
        ),
    );

    assertEquals([ ...parser.parse("A") ], [ [ "A" ] ]);
    assertThrows(() => [ ...parser.parse("B") ]);
});

Deno.test("Chainable sequence parser with two matches", () => {
    const parser = new Parser(
        sequence(
            match(/^A$/m),
            match(/^B$/m),
        ),
    );

    assertEquals([ ...parser.parse("AB") ], [ [ "A", "B" ] ]);
    assertThrows(() => [ ...parser.parse("B") ]);
});

Deno.test("Chainable sequence parser with two matches and map transformation", () => {
    const parser = new Parser(
        sequence(
            match(/^A$/m),
            match(/^B$/m),
        )
            .map(_ => _.join()),
    );

    assertEquals([ ...parser.parse("AB") ], [ "A,B" ]);
    assertThrows(() => [ ...parser.parse("B") ]);
});

Deno.test("Chainable choice parser with two matches", () => {
    const parser = new Parser(
        choice(
            match(/^A$/m),
            match(/^B$/m),
        ),
    );

    assertEquals([ ...parser.parse("AB") ], [ "A", "B" ]);
    assertThrows(() => [ ...parser.parse("C") ]);
});

Deno.test("Chainable match parser with then chaining", () => {
    const parser = new Parser(
        match(/^A$/m)
            .then({
                * [Symbol.iterator](output) {
                    return [ output, yield* match(/^B$/m) ];
                },
            }),
    );

    assertEquals([ ...parser.parse("AB") ], [ [ "A", "B" ] ]);
    assertThrows(() => [ ...parser.parse("A") ]);
});

Deno.test("Chainable match parser with then chaining and sequence", () => {
    const parser = new Parser(
        match(/^A$/m)
            .then({
                * [Symbol.iterator](output) {
                    return yield* sequence(
                        match(/^B$/m),
                        noop(output),
                    );
                },
            }),
    );

    assertEquals([ ...parser.parse("AB") ], [ [ "B", "A" ] ]);
    assertThrows(() => [ ...parser.parse("B") ]);
});

Deno.test("Chainable match parser with then chaining and choice", () => {
    const parser = new Parser(
        match(/^[a-z]$/m)
            .then(output => choice(
                    sequence(
                        noop(output),
                        equals("("),
                        equals(")"),
                    ),
                    sequence(
                        noop(output),
                        equals("."),
                        match(/^[a-z]$/m),
                    ),
                )
            ),
    );

    assertEquals([ ...parser.parse("a.b") ], [ [ "a", ".", "b" ] ]);
    assertEquals([ ...parser.parse("a()") ], [ [ "a", "(", ")" ] ]);
    assertThrows(() => [ ...parser.parse("C") ]);
});

Deno.test("Chainable equals parser with catch fallback", () => {
    const parser = new Parser(
        equals("A")
            .catch(equals("B")),
    );

    assertEquals([ ...parser.parse("B") ], [ "B" ]);
    assertEquals([ ...parser.parse("A") ], [ "A" ]);
    assertThrows(() => [ ...parser.parse("C") ]);
});


Deno.test("Chainable match parser with next chaining and repeated choice", () => {
    const parser = new Parser(
        match(/^[a-z]$/m)
            .next(
                choice(
                    sequence(
                        equals("("),
                        equals(")"),
                    )
                        .map(_ => _.join("")),
                    sequence(
                        equals("."),
                        match(/^[a-z]$/m),
                    )
                        .map(_ => _.join("")),
                )
                    .repeat(0)
            ),
    );

    assertEquals([ ...parser.parse("a.b") ], [ [ "a", [ ".b" ] ] ]);
    assertEquals([ ...parser.parse("a()") ], [ [ "a", [ "()" ] ] ]);

    assertEquals([ ...parser.parse("a.b.b") ], [ [ "a", [ ".b", ".b" ] ] ]);
    assertEquals([ ...parser.parse("a()()") ], [ [ "a", [ "()", "()" ] ] ]);

    assertEquals([ ...parser.parse("a.b()") ], [ [ "a", [ ".b", "()" ] ] ]);
    assertEquals([ ...parser.parse("a().b") ], [ [ "a", [ "()", ".b" ] ] ]);

    assertThrows(() => [ ...parser.parse("C") ]);
});
