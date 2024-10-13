/**
 * Represents a position tracker (cursor) in a text stream.
 *
 * @class
 */
export class Cursor {
    /**
     * Creates a new instance of Cursor.
     *
     * @param {URL} source - The URL of the source document.
     * @param {number} [position=0] - The current position in the text.
     * @param {number} [column=0] - The current column position in the line.
     * @param {number} [line=0] - The current line number.
     */
    constructor(
        readonly source: URL,
        readonly position = 0,
        readonly column = 0,
        readonly line = 0,
    ) {
    }

    /**
     * Applies the given text to the cursor, updating its position, line, and column.
     *
     * @param {string} text - The text to apply to the cursor.
     * @returns {Cursor} - A new Cursor instance updated with the applied text.
     * @example
     * const cursor = new Cursor(new URL('https://example.com'));
     * const updatedCursor = cursor.apply("Hello\nWorld");
     */
    apply(text: string): Cursor {
        let position = this.position;
        let column = this.column;
        let line = this.line;

        for (const character of text) {
            if (position !== -1) {
                position += 1;
            }

            if (character !== "\n") {
                column += 1;
            } else {
                column = 0;
                line += 1;
            }
        }

        return new Cursor(this.source, position, column, line);
    }

    /**
     * Converts the Cursor to a human-readable string format.
     *
     * @returns {string} - The string representation of the cursor's position in the format `source:line:column`.
     * @example
     * const cursor = new Cursor(new URL('https://example.com'));
     * console.log(`${cursor}`); // Outputs: "https://example.com:1:1"
     */
    [Symbol.toPrimitive](): string {
        return `${this.source.href}:${this.line + 1}:${this.column + 1}`;
    }

    /**
     * Custom inspect method for the cursor, used for console output in Deno.
     *
     * @returns {string} - The string representation of the cursor for inspection.
     */
    [Symbol.for("Deno.customInspect")](): string {
        return this[Symbol.toPrimitive]();
    }
}

/**
 * Represents a span (range) between two Cursor positions.
 *
 * @class
 */
export class Span {
    /**
     * Creates a new instance of Span.
     *
     * @param {Cursor} begin - The Cursor marking the beginning of the span.
     * @param {Cursor} end - The Cursor marking the end of the span.
     * @example
     * const begin = new Cursor(new URL('https://example.com'), 0, 0, 0);
     * const end = new Cursor(new URL('https://example.com'), 5, 5, 1);
     * const span = new Span(begin, end);
     */
    constructor(
        readonly begin: Cursor,
        readonly end: Cursor,
    ) {
    }
}