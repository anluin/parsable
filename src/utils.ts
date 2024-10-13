import { ParserProgram } from "./parser.ts";
import { Cursor } from "./location.ts";


/**
 * Resolves the character position in the contents string based on the given line and column numbers.
 *
 * @param {string} contents - The string contents where the cursor position needs to be resolved.
 * @param {{ column: number, line: number }} cursor - The object containing line and column numbers.
 * @returns {number} - The character position or -1 if the position is not found.
 * @example
 * const position = resolveCursorPosition("Hello\nWorld", { line: 1, column: 3 });
 * // Returns 8
 */
export const resolveCursorPosition = (contents: string, cursor: { column: number, line: number }): number => {
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
 * Constructs a Cursor object by analyzing a tag function call's stack trace to determine the code location.
 *
 * @param {Function} [constructor] - An optional constructor function to aid stack trace capture.
 * @param {Error} [error=new Error()] - An optional error object used for capturing the stack trace.
 * @returns {Cursor} - A cursor object representing the position in the file.
 * @throws {TypeError} If the stack trace extraction fails.
 * @example
 * const cursor = cursorFromTagFunctionCall();
 */
// deno-lint-ignore ban-types
const cursorFromTagFunctionCall = (constructor?: Function, error = new Error()) => {
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

        if ((position = resolveCursorPosition(contents, {column, line})) !== -1) {
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

/**
 * Abstract class representing a Parser Program with cursor tracking capabilities.
 *
 * @extends {ParserProgram<string, Output>}
 */
export abstract class ParserProgramWithCursor<Output> extends ParserProgram<string, Output> {
    /** @private */
    readonly #cursorStack: Cursor[];

    /**
     * Gets the current cursor object from the cursor stack.
     *
     * @returns {Cursor} - The current cursor position.
     */
    get cursor(): Cursor {
        return this.#cursorStack.at(-1)!;
    }

    /**
     * Constructs a ParserProgramWithCursor instance.
     *
     * @param {Cursor} cursor - The initial cursor object to start with.
     */
    constructor(cursor: Cursor) {
        super({
            onConsumption: (input) =>
                this.#cursorStack.push(this.#cursorStack.at(-1)!.apply(input)),
            onRollback: (inputs) =>
                this.#cursorStack.splice(this.#cursorStack.length - inputs.length),
            onReturn: () =>
                this.#cursorStack.splice(0, -1),
        });

        this.#cursorStack = [ cursor ];
    }
}
