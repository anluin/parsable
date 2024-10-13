import { Parser } from "./parser.ts";

/**
 * Represents a cursor that tracks position, column, and line within a source.
 *
 * @class Cursor
 */
export class Cursor {
    /**
     * Creates an instance of Cursor.
     *
     * @constructor
     * @param {URL} source - The source file location.
     * @param {number} [position=0] - The initial position of the cursor.
     * @param {number} [column=0] - The initial column of the cursor.
     * @param {number} [line=0] - The initial line of the cursor.
     */
    constructor(
        readonly source: URL,
        readonly position = 0,
        readonly column = 0,
        readonly line = 0,
    ) {
    }

    /**
     * Applies a text input to the current cursor position, updating its state.
     *
     * @param {string} text - The text to apply to the cursor.
     * @returns {Cursor} A new cursor reflecting the updated state.
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
     * Converts the cursor to a string representation.
     *
     * @returns {string} The string representation of the cursor.
     */
    toString(): string {
        return `${this.source.href}:${this.line + 1}:${this.column + 1}`;
    }

    /**
     * Converts the cursor to a string representation.
     *
     * @returns {string} The string representation of the cursor.
     */
    [Symbol.toPrimitive](): string {
        return this.toString();
    }

    /**
     * Custom string inspect implementation.
     *
     * @returns {string} The inspected string.
     */
    [Symbol.for("Deno.customInspect")](): string {
        return this.toString();
    }

    /**
     * Resolves the actual cursor position based on line and column numbers.
     *
     * @static
     * @param {string} contents - The text contents of the file.
     * @param {{ column: number, line: number }} cursor - The line and column to resolve.
     * @returns {number} The resolved cursor position or -1 if not found.
     */
    static resolveCursorPosition(contents: string, cursor: { column: number, line: number }): number {
        let position = 0;
        let column = 0;
        let line = 0;

        for (const character of contents) {
            if (position !== -1) {
                position += 1;
            }

            if (character !== "\n") {
                column += 1;
            } else {
                column = 0;
                line += 1;
            }

            if (line === cursor.line && column === cursor.column - 1) {
                return position;
            }
        }

        return -1;
    };

    /**
     * Creates a cursor from a tag function call using the error stack trace.
     *
     * @static
     * @param {Function} [constructor] - The function used to capture the stack trace.
     * @param {Error} [error=new Error()] - An error instance used for stack capturing.
     * @returns {Cursor} The cursor derived from the stack trace information.
     * @throws {TypeError} If the stack trace can't be parsed.
     */
    // deno-lint-ignore ban-types
    static fromTagFunctionCall(constructor?: Function, error: Error = new Error()): Cursor {
        Error.captureStackTrace(error, constructor);

        const regExpResult = (
            /^\s+at\s+(\S+\s+)?\(?(?<rawSource>file:\/{2}.*):(?<rawLine>\d+):(?<rawColumn>\d+)\)?$/m
                .exec(error.stack ?? "")
        );

        if (!regExpResult?.groups) {
            throw new TypeError(`Failed to extract first stack-trace entry`);
        }

        const {rawSource, rawLine, rawColumn} = regExpResult.groups;
        const source = new URL(rawSource);

        let column = +rawColumn;
        let line = +rawLine - 1;
        let position = -1;

        if (Deno.permissions.querySync({
            name: "read",
            path: source.pathname,
        }).state === "granted") {
            const contents = Deno.readTextFileSync(source.pathname);

            if ((position = this.resolveCursorPosition(contents, {column, line})) !== -1) {
                for (const character of contents.slice(position)) {
                    if (character === "`") break;

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
            }
        }

        return new Cursor(source, position, column, line);
    };
}

/**
 * Abstract class for parser with cursor tracking capabilities.
 *
 * @abstract
 * @class ParserWithCursorTracking
 * @template Output
 * @extends {Parser<string, Output>}
 */
export abstract class ParserWithCursorTracking<Output> extends Parser<string, Output> {
    readonly #cursorStack: Cursor[];

    /**
     * Creates an instance of ParserWithCursorTracking.
     *
     * @constructor
     * @param {Cursor} cursor - The initial cursor object.
     */
    constructor(cursor: Cursor) {
        super();
        this.#cursorStack = [ cursor ];
    }

    /**
     * Gets the current cursor.
     *
     * @readonly
     * @type {Cursor}
     */
    get cursor(): Cursor {
        return this.#cursorStack.at(-1)!;
    }

    /**
     * Updates the cursor stack upon input consumption.
     *
     * @override
     * @param {string} input - The input string being consumed.
     */
    override onConsumption(input: string) {
        this.#cursorStack.push(this.#cursorStack.at(-1)!.apply(input));
    }

    /**
     * Rolls back the cursor stack on parser rollback.
     *
     * @override
     * @param {string[]} inputs - The list of strings for rollback.
     */
    override onRollback(inputs: string[]) {
        this.#cursorStack.splice(this.#cursorStack.length - inputs.length);
    }

    /**
     * Cleans up the cursor stack on parser return.
     */
    override onReturn() {
        this.#cursorStack.splice(0, -1);
    }
}
