const peek: unique symbol = Symbol();

export type Peek = typeof peek;

const consume: unique symbol = Symbol();

export type Consume = typeof consume;

export const endOfInput: unique symbol = Symbol();

export type EndOfInput = typeof endOfInput;

/**
 * Types of requests a parser can make.
 */
export type ParserRequest<Input> = Peek | Consume | typeof ParserSnapshot | ParserSnapshot;

/**
 * Possible responses for a parser.
 */
export type ParserResponse<Input> = Input | EndOfInput | ParserSnapshot;

/**
 * A generator yielding ParserRequests and producing an Output.
 *
 * @template Input
 * @template Output
 */
export type ParserGenerator<Input, Output> = Generator<ParserRequest<Input>, Output, ParserResponse<Input>>;

/**
 * A snapshot of the parser's current state.
 *
 * @class ParserSnapshot
 */
export class ParserSnapshot {
    /**
     * Creates an instance of ParserSnapshot.
     *
     * @constructor
     * @param {ParserState<unknown, unknown>} state - The current parser state.
     * @param {number} [cursor=state.cursor] - The current cursor position.
     */
    constructor(
        readonly state: ParserState<unknown, unknown>,
        readonly cursor: number = state.cursor,
    ) {
    }
}

/**
 * Error thrown when the end of input is unexpectedly reached.
 *
 * @class EndOfInputError
 * @extends {SyntaxError}
 */
export class EndOfInputError extends SyntaxError {
    /**
     * Creates an instance of EndOfInputError.
     *
     * @constructor
     * @param {string} [message] - Optional custom error message.
     */
    constructor(message?: string) {
        super(message ?? "Unexpected end of input");
    }
}

/**
 * Represents the state of the parser.
 *
 * @template Input
 * @template Output
 * @typedef {{ generator: ParserGenerator<Input, Output>, result: IteratorYieldResult<ParserRequest<Input>>, cursor: number }} ParserState
 */
export type ParserState<Input, Output> = {
    generator: ParserGenerator<Input, Output>,
    result: IteratorYieldResult<ParserRequest<Input>>,
    cursor: number,
};

/**
 * Options for parsing.
 */
export type ParserParseOptions = {
    stream?: boolean,
};

/**
 * Abstract class defining a generic parser.
 *
 * @abstract
 * @class Parser
 * @template Input
 * @template Output
 */
export abstract class Parser<Input, Output> {
    readonly #buffer: Input[] = [];
    #state?: ParserState<Input, Output>;

    onConsumption?(input: Input): void;
    onRollback?(inputs: Input[]): void;
    onReturn?(output: Output): void;

    /**
     * Defines the generator function to parse inputs and yield outputs.
     *
     * @abstract
     * @returns {ParserGenerator<Input, Output>}
     */
    abstract parse(): ParserGenerator<Input, Output>;

    /**
     * Internal method to process parser commands.
     *
     * @generator
     * @returns {Generator<Output>}
     * @throws {TypeError} If the parser has not consumed any input and is prematurely complete.
     */
    * #process(): Generator<Output> {
        if (!this.#state) {
            const generator = this.parse();
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
            this.onRollback?.(this.#buffer.slice(request.cursor, this.#state.cursor));
            this.#state.cursor = request.cursor;
            result = this.#state.generator.next(request);
        } else if (this.#state.cursor < this.#buffer.length) {
            const item = this.#buffer[this.#state.cursor];

            if (request === consume) {
                this.onConsumption?.(item);
                this.#state.cursor++;
            }

            result = this.#state.generator.next(item);
        } else {
            result = this.#state.generator.next(endOfInput);
        }

        if (result.done) {
            this.#buffer.splice(0, this.#state.cursor);
            this.onReturn?.(result.value);
            this.#state = undefined;
            yield result.value;
        } else {
            this.#state.result = result;
        }
    }

    /**
     * Processes the given input and produces the result.
     *
     * @param {Iterable<Input> | null} input - The input to be processed.
     * @param {ParserParseOptions} [options] - The options for parsing.
     * @generator
     * @returns {Iterable<Output>} The processed output.
     */
    * process(input: Iterable<Input> | null, options?: ParserParseOptions): Iterable<Output> {
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
     * Internal command execution for peek or consume operations.
     *
     * @generator
     * @param {Peek | Consume} command - The command to execute.
     * @param {Function} [constructor] - The error constructor for stack tracing.
     * @returns {ParserGenerator<Input, Input>}
     * @throws {EndOfInputError} If the end of input is reached unexpectedly.
     */
    // deno-lint-ignore ban-types
    * #command(command: Peek | Consume, constructor?: Function): ParserGenerator<Input, Input> {
        const item = (yield command) as Exclude<ParserResponse<Input>, ParserSnapshot>;

        if (item === endOfInput) {
            const error = new EndOfInputError();
            Error.captureStackTrace(error, constructor);
            throw error;
        }

        return item;
    }

    /**
     * Requests to peek the next item from input without consuming it.
     *
     * @generator
     * @returns {ParserGenerator<Input, Input>}
     */
    * peek(): ParserGenerator<Input, Input> {
        return yield* this.#command(peek, this.peek);
    }

    /**
     * Requests to consume the next item from input.
     *
     * @generator
     * @returns {ParserGenerator<Input, Input>}
     */
    * consume(): ParserGenerator<Input, Input> {
        return yield* this.#command(consume, this.consume);
    }

    /**
     * Requests to take a snapshot of the current parser state.
     *
     * @generator
     * @returns {ParserGenerator<Input, ParserSnapshot>}
     */
    * snapshot<Input>(): ParserGenerator<Input, ParserSnapshot> {
        return (yield ParserSnapshot) as ParserSnapshot;
    }
}
