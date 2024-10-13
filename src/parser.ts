/**
 * The `peek` symbol is used in parser generators to request and inspect the next input item without consuming it.
 */
const peek: unique symbol = Symbol();

/**
 * The `consume` symbol is used in parser generators to request and consume the next input item.
 */
const consume: unique symbol = Symbol();

/**
 * The `endOfInput` symbol represents the state when no more input is available to the parser.
 */
export const endOfInput: unique symbol = Symbol();

/**
 * Types of requests that can be made by a parser: peek, consume, take a snapshot, or a snapshot instance itself.
 */
export type ParserRequest<Input> = typeof peek | typeof consume | typeof ParserSnapshot | ParserSnapshot;

/**
 * Types of responses a parser can produce: an input item, end of input, or a snapshot instance.
 */
export type ParserResponse<Input> = Input | typeof endOfInput | ParserSnapshot;

/**
 * A generator-based parser that produces an output from a series of parser requests and responses.
 */
export type ParserGenerator<Input, Output> = Generator<ParserRequest<Input>, Output, ParserResponse<Input>>;

/**
 * Asserts that a condition is true, otherwise throws an error using a constructor and an error creation function.
 *
 * @param {any} condition - The condition to be asserted.
 * @param {Function} constructor - The function constructor, usually of the calling function, for stack trace.
 * @param {() => Error} constructError - A function that returns the error to be thrown.
 * @throws {Error} If the condition is false, throws the constructed error.
 */
// deno-lint-ignore no-explicit-any ban-types
function assert(condition: any, constructor: Function, constructError: () => Error): asserts condition {
    if (!condition) {
        const error = constructError();
        Error.captureStackTrace(error, constructor);
        throw error;
    }
}

/**
 * A snapshot of the parser's state, including the cursor position.
 */
export class ParserSnapshot {
    /**
     * Constructs a snapshot of the parser's state.
     *
     * @param {ParserState<unknown, unknown>} state - The current state of the parser.
     * @param {number} [cursor=state.cursor] - The position of the cursor in the input.
     */
    constructor(
        readonly state: ParserState<unknown, unknown>,
        readonly cursor: number = state.cursor,
    ) {
    }
}

/**
 * Represents an error due to reaching an unexpected end of input in the parser.
 */
export class EndOfInput extends SyntaxError {
    /**
     * Constructs an EndOfInput error.
     *
     * @param {string} [message] - Optional message describing the error.
     */
    constructor(message?: string) {
        super(message ?? "Unexpected end of input");
    }
}

/**
 * Hooks interface for parsing actions, allowing consumption, rollback, and return events.
 */
export interface ParserProgramHooks<Input, Output> {
    onConsumption?(input: Input): void;
    onRollback?(inputs: Input[]): void;
    onReturn?(output: Output): void;
}

/**
 * Abstract class representing a parser program that parses input and produces output,
 * implemented by extending this class and providing a generator function.
 */
export abstract class ParserProgram<Input, Output> {
    /**
     * Constructs a parser program with optional hooks.
     *
     * @param {ParserProgramHooks<Input, Output>} [hooks] - Optional hooks for parser events.
     */
    protected constructor(
        readonly hooks?: ParserProgramHooks<Input, Output>,
    ) {
    }

    /**
     * Abstract method that subclasses must implement to define parsing logic as a generator.
     *
     * @returns {ParserGenerator<Input, Output>} - The generator for parsing input into output.
     */
    abstract parse(): ParserGenerator<Input, Output>;
}

/**
 * Represents the state of parsing, including the generator, result, and cursor position.
 */
export type ParserState<Input, Output> = {
    generator: ParserGenerator<Input, Output>,
    result: IteratorYieldResult<ParserRequest<Input>>,
    cursor: number,
};

/**
 * Options for configuring parser behavior, including streaming.
 */
export type ParserParseOptions = {
    stream?: boolean,
};

/**
 * Class implementing the parsing process using a specified parser program.
 */
export class Parser<Input, Output> {
    readonly #program: ParserProgram<Input, Output>;
    readonly #buffer: Input[] = [];
    #state?: ParserState<Input, Output>;

    /**
     * Constructs a parser with the specified parser program.
     *
     * @param {ParserProgram<Input, Output>} program - The parser program to use for parsing.
     */
    constructor(program: ParserProgram<Input, Output>) {
        this.#program = program;
    }

    /**
     * Processes the input and executes the parser generator logic.
     *
     * @returns {Generator<Output>} - Generator yielding the parsed outputs.
     * @throws {TypeError} If the parser has not consumed any input.
     */
    * #process(): Generator<Output> {
        if (!this.#state) {
            const generator = this.#program.parse();
            const result = generator.next();

            if (result.done) {
                throw new TypeError("Given parser has not consumed any input");
            }

            this.#state = {generator, result, cursor: 0};
        }

        const request: ParserRequest<Input> = this.#state.result.value;
        let result: IteratorResult<ParserRequest<Input>>;

        if (request === ParserSnapshot) {
            result = this.#state.generator.next(new ParserSnapshot(this.#state));
        } else if (request instanceof ParserSnapshot) {
            if (this.#state !== request.state) throw new Error();
            this.#program.hooks?.onRollback?.(this.#buffer.slice(request.cursor, this.#state.cursor));
            this.#state.cursor = request.cursor;
            result = this.#state.generator.next(request);
        } else if (this.#state.cursor < this.#buffer.length) {
            const item = this.#buffer[this.#state.cursor];

            if (request === consume) {
                this.#program.hooks?.onConsumption?.(item);
                this.#state.cursor++;
            }

            result = this.#state.generator.next(item);
        } else {
            result = this.#state.generator.next(endOfInput);
        }

        if (result.done) {
            this.#buffer.splice(0, this.#state.cursor);
            this.#program.hooks?.onReturn?.(result.value);
            this.#state = undefined;
            yield result.value;
        } else {
            this.#state.result = result;
        }
    }

    /**
     * Parses the input using the parser program and yields the output.
     *
     * @param {Iterable<Input> | null} input - The input sequence to parse.
     * @param {ParserParseOptions} [options] - Optional parsing options.
     * @returns {Iterable<Output>} - An iterable sequence of parsed outputs.
     */
    * parse(input: Iterable<Input> | null, options?: ParserParseOptions): Iterable<Output> {
        if (input !== null) for (const item of input) {
            this.#buffer.push(item);

            do yield* this.#process(); while ((
                this.#buffer.length > (this.#state?.cursor ?? 0)
            ));
        }

        if (!options?.stream) while ((
            this.#state?.result.done === false ||
            this.#buffer.length > 0
        )) yield* this.#process();
    }

    /**
     * A static generator function that returns the next input item without consuming it.
     *
     * @param {(input: Input) => void} [test] - An optional test function to validate the input.
     * @returns {ParserGenerator<Input, Input>} - The generator yielding the peeked input item.
     * @throws {EndOfInput} If end of input is reached unexpectedly.
     */
    static* peek<Input>(test?: (input: Input) => void): ParserGenerator<Input, Input> {
        const result = (yield peek) as Exclude<ParserResponse<Input>, ParserSnapshot>;
        assert(result !== endOfInput, this.peek, () => new EndOfInput());
        test?.(result);
        return result;
    }

    /**
     * A static generator function that returns the next input item and consumes it.
     *
     * @param {(input: Input) => void} [test] - An optional test function to validate the input.
     * @returns {ParserGenerator<Input, Input>} - The generator yielding the consumed input item.
     * @throws {EndOfInput} If end of input is reached unexpectedly.
     */
    static* consume<Input>(test?: (input: Input) => void): ParserGenerator<Input, Input> {
        test?.(yield* Parser.peek());
        const result = (yield consume) as Exclude<ParserResponse<Input>, ParserSnapshot>;
        assert(result !== endOfInput, this.consume, () => new EndOfInput());
        return result;
    }

    /**
     * A static generator function that returns a snapshot of the current parser state.
     *
     * @returns {ParserGenerator<Input, ParserSnapshot>} - The generator yielding a parser snapshot.
     */
    static* snapshot<Input>(): ParserGenerator<Input, ParserSnapshot> {
        return (yield ParserSnapshot) as ParserSnapshot;
    }
}
