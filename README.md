# Parsable

Parsable is an experimental library designed to explore possibilities for implementing a parser framework using generator functions in TypeScript. The goal of Parsable is to provide a flexible and modular approach to parsing streams of input, whether it's text, bytes, or any other data type. By leveraging generator functions, Parsable aims to offer an intuitive and chainable API for parsing operations.

## Features

- **Generator-based Parsing**: Utilize generator functions to manage parsing state and operations seamlessly.
- **Chainable API**: Compose complex parsers using a fluent interface for enhanced readability and maintainability.
- **Snapshot and Backtracking**: Easily backtrack to previous states in the parsing process using snapshots.
- **Flexible Input Handling**: Parse input streams of various types, including text and binary data.
- **Streaming Support**: Handle large or streaming inputs efficiently with optional streaming mode.

## Usage

### Basic Example

Here's a simple example of using Parsable to parse a sequence of digits:

```typescript
import { Parser, expect, match } from "jsr:@anluin/parsable";

// Define a parser for digits
const digitParser = expect(match(/[0-9]/))
    .repeat(1)
    .map(digits => digits.join(""));

// Create a parser instance
const parser = new Parser(digitParser);

// Parse an input string
const result = parser.parse("12345");
console.log(result); // Output: "12345"
```

### Choice and Sequence Parsing

Parsable allows for choice-based parsing, trying multiple parsers in sequence until one succeeds:

```typescript
import { Parser, expect, equals, choice } from "jsr:@anluin/parsable";

// Define parsers for specific tokens
const fooParser = expect(equals("foo"));
const barParser = expect(equals("bar"));

// Create a choice parser
const choiceParser = new Parser(choice(fooParser, barParser));

// Test the choice parser
console.log(choiceParser.parse(["foo"])); // Output: "foo"
console.log(choiceParser.parse(["bar"])); // Output: "bar"
```

### Error Handling

Parsable provides detailed error messages and supports handling multiple parsing errors:

```typescript
import { Parser, expect, equals, ChoiceParserError } from "jsr:@anluin/parsable";

const parser = new Parser(
    choice(
        expect(equals("foo")),
        expect(equals("bar"))
    )
);

try {
    parser.parse([ "baz" ]);
} catch (error) {
    if (error instanceof ChoiceParserError) {
        console.error("Failed to parse input:", error.errors);
    }
}
```
