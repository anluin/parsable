// noinspection JSUnusedGlobalSymbols,ExceptionCaughtLocallyJS

const peekInputRequest: unique symbol = Symbol("peek input request");
type PeekInputRequest = typeof peekInputRequest;

const eatInputRequest: unique symbol = Symbol("eat input request");
type EatInputRequest = typeof eatInputRequest;

const snapshotRequest: unique symbol = Symbol("snapshot request");
type SnapshotRequest = typeof snapshotRequest;

export const EndOfInput: unique symbol = Symbol("end of input");
export type EndOfInput = typeof EndOfInput;

/**
 * Represents a point in input parsing that can be restored.
 * Useful for backtracking in parsing operations.
 */
export class Snapshot {
    constructor(readonly index: number) {
    }
}

/**
 * Enumerates possible requests a parser can make during its operation.
 *
 * - `PeekInputRequest`: Requests to view the next input without consuming it.
 * - `EatInputRequest`: Requests to consume the next input value.
 * - `SnapshotRequest`: Requests a record of the current parsing state.
 * - `Snapshot`: A position that can be restored to within the input stream.
 */
type Request = PeekInputRequest | EatInputRequest | SnapshotRequest | Snapshot;

/**
 * Represents responses to parser requests, providing inputs or state information.
 *
 * Responses can be:
 * - An input value of type `Input`
 * - `EndOfInput` to signal no more inputs are available
 * - A `Snapshot` object representing a state to restore.
 */
type Response<Input> = Input | EndOfInput | Snapshot;

/**
 * A generator used to handle parsing operations.
 *
 * The generator yields `Request` objects to perform operations
 * like peeking or consuming input, and receives `Response` objects
 * corresponding to those requests.
 */
export type ParserGenerator<Input, Output> = Generator<Request, Output, Response<Input>>;

/**
 * Interface for parsable entities, defining a standard way to generate parser operations.
 *
 * Parsers adhering to `IParsable` can be seamlessly integrated into the parsing framework,
 * enabling complex parsing logic with flexibility.
 */
export interface IParsable<Input = unknown, Output = unknown, Args extends unknown[] = []> {
    [Symbol.iterator](...args: Args): ParserGenerator<Input, Output>;
}

export type IParsableInput<T> = T extends IParsable<infer Input, unknown, unknown[]> ? Input : never;
export type IParsableOutput<T> = T extends IParsable<unknown, infer Output, unknown[]> ? Output : never;
export type IParsableArgs<T> = T extends IParsable<unknown, unknown, infer Args> ? Args : never;

export type ISpawnParsable<T extends IParsable<unknown, unknown, unknown[]>> = () => ParserGenerator<IParsableInput<T>, IParsableOutput<T>>;

interface ParserState<T extends IParsable<unknown, unknown, unknown[]>> {
    generator: ParserGenerator<IParsableInput<T>, IParsableOutput<T>>,
    request: Request,
    index: number,
}

/**
 * Options for parsing, such as streaming mode.
 */
export type ParseOptions = {
    stream: boolean,
}

/**
 * Manages parsing logic for sequences of input, utilizing a provided parsable entity.
 *
 * Implements robust error handling and state management to ensure consistent and accurate parsing,
 * providing methods for both single and repeated input parsing.
 *
 * The `Parser` class handles stateful operations, buffering input and reinitializing parsers as needed.
 */
export class Parser<T extends IParsable<unknown, unknown, unknown[]>> {
    readonly #inputBuffer: IParsableInput<T>[] = [];
    readonly #spawn: ISpawnParsable<T>;

    #state?: ParserState<T>;

    constructor(parsable: T, ...args: IParsableArgs<T>) {
        this.#spawn = parsable[Symbol.iterator].bind(parsable, ...args) as ISpawnParsable<T>;
    }

    /**
     * Initializes the parser state by spawning a new parser generator.
     *
     * Used to start or restart parser operations as needed. This ensures
     * that the parser has a fresh state to work with when incorrect inputs
     * have been discarded or when a new parsing session is started.
     */
    #createState(): ParserState<T> {
        const generator = this.#spawn();
        const result = generator.next();

        if (result.done) {
            throw new Error("Parser has not consumed any input");
        }

        return {
            generator,
            request: result.value,
            index: 0,
        };
    }

    /**
     * Retrieves the next input from the buffered inputs or from an external iterator.
     *
     * Ensures the parser can either reuse already buffered inputs or fetch new inputs
     * as needed. This supports both buffered and streaming inputs effectively.
     */
    #fetchInput(inputs?: Iterator<IParsableInput<T>>, state?: ParserState<T>): IParsableInput<T> | EndOfInput {
        if (state && state.index < this.#inputBuffer.length) {
            return this.#inputBuffer[state.index];
        } else if (inputs) {
            const result = inputs.next();

            if (!result.done) {
                return this.#inputBuffer[state?.index ?? 0] = result.value;
            }
        }

        return EndOfInput;
    }

    /**
     * Parses multiple inputs from an iterable source, yielding outputs progressively.
     *
     * Designed for situations where the input may be large or needs to be streamed,
     * allowing for handling of incomplete data in "stream" mode.
     */
    * #parse(inputs: Iterable<IParsableInput<T>>, options?: ParseOptions): Iterable<IParsableOutput<T>> {
        const inputsIterator = inputs[Symbol.iterator]();

        let input = this.#fetchInput(inputsIterator, this.#state);

        if (input !== EndOfInput || options?.stream !== true) {
            let state = this.#state ?? this.#createState();

            while (!(input === EndOfInput && options?.stream === true)) {
                let result: IteratorResult<Request, IParsableOutput<T>>;

                switch (state.request) {
                    case snapshotRequest:
                        result = state.generator.next(new Snapshot(state.index));
                        break;

                    case peekInputRequest:
                        result = state.generator.next(input);
                        break;

                    case eatInputRequest:
                        state.index += 1;
                        result = state.generator.next(input);
                        input = this.#fetchInput(inputsIterator, state);
                        break;

                    default:
                        if (state.request instanceof Snapshot) {
                            state.index = state.request.index;
                            result = state.generator.next(input);
                            input = this.#fetchInput(inputsIterator, state);
                        } else {
                            throw new Error(`unimplemented request: ${Deno.inspect(state.request)}`);
                        }
                }

                if (result.done) {
                    this.#inputBuffer.splice(0, state.index);

                    if (input !== EndOfInput || options?.stream === true) {
                        state = this.#createState();
                    }

                    yield result.value;

                    if (input === EndOfInput) {
                        break;
                    }
                } else {
                    state.request = result.value;
                }
            }

            if (options?.stream !== true) {
                this.#inputBuffer.length = 0;
                this.#state = undefined;
            } else {
                this.#state = state;
            }
        }
    }

    // deno-lint-ignore ban-types
    #fixErrorCause(constructor: Function, error: unknown) {
        if (error instanceof Error && error.cause instanceof Error) {
            Error.captureStackTrace(error.cause, constructor);
            this.#fixErrorCause(constructor, error.cause);
        }

        if (error instanceof AggregateError) {
            for (const aggregatedError of error.errors) {
                this.#fixErrorCause(constructor, aggregatedError);
            }
        }
    }

    /**
     * Parses multiple inputs from an iterable source, yielding outputs progressively.
     *
     * Designed for situations where the input may be large or needs to be streamed,
     * allowing for handling of incomplete data in "stream" mode.
     */
    all(inputs: Iterable<IParsableInput<T>>, options?: ParseOptions): Iterable<IParsableOutput<T>> {
        try {
            return this.#parse(inputs, options);
        } catch (error) {
            if (error instanceof Error && !(error instanceof ParserError)) {
                Error.captureStackTrace(error, this.all);
            }

            this.#fixErrorCause(this.all, error);
            throw error;
        }
    }

    /**
     * Parses the inputs and returns the first output result.
     */
    first(inputs: Iterable<IParsableInput<T>>, options?: ParseOptions): IParsableOutput<T> | undefined {
        try {
            // noinspection LoopStatementThatDoesntLoopJS
            for (const value of this.#parse(inputs, options)) {
                return value;
            }
        } catch (error) {
            if (error instanceof Error && !(error instanceof ParserError)) {
                Error.captureStackTrace(error, this.first);
            }

            this.#fixErrorCause(this.all, error);
            throw error;
        }
    }
}

/**
 * A base class for errors occurring during parsing operations.
 *
 * Provides a foundation for more specific parser errors with enriched
 * contextual information, ensuring traceable and descriptive error messages.
 *
 * Automatically captures the stack trace, allowing developers to identify
 * the error's point of origin within the parsing process.
 */
export class ParserError extends Error {
    override name = this.constructor.name;

    // deno-lint-ignore ban-types
    constructor(constructor: Function, message?: string) {
        super(message);
        Error.captureStackTrace(this, constructor);
    }

    override get message(): string {
        return super.message || (
            this.cause instanceof Error
                ? this.cause?.message
                : ""
        );
    }
}

/**
 * Indicates a critical parsing error from which recovery is not possible.
 *
 * Used to immediately halt parsing operations without allowing recovery
 * through standard catch blocks. Essential for enforcing strict parsing
 * requirements where data validity cannot be compromised.
 */
export class FatalParserError extends ParserError {
    override name = this.constructor.name;
}

/**
 * An error that encapsulates multiple potential parsing errors occurring in choice parsers.
 * Provides detailed information about each failed parsing attempt, allowing developers
 * to debug complex input structures or mismatches.
 *
 * Ideal for use in parsers where multiple potential valid paths exist, but all fail,
 * requiring insights into the failure of each path.
 */
export class ChoiceParserError extends AggregateError {
    override name = this.constructor.name;

    // deno-lint-ignore ban-types
    constructor(constructor: Function, errors: Iterable<unknown> = [], message?: string) {
        super(errors, message);
        Error.captureStackTrace(this, constructor);
    }
}

/**
 * Thrown when input does not match expected criteria during parsing.
 *
 * This error delineates what specific input was encountered and what was expected,
 * assisting in debugging parsing errors related to data formats, tokens, or pattern mismatches.
 */
export class UnexpectedInputError<Input, Expectation> extends ParserError {
    override name = this.constructor.name;

    // deno-lint-ignore ban-types
    constructor(constructor: Function, readonly value: Input, readonly expectation: Expectation) {
        super(constructor);
    }

    override get message(): string {
        return `Unexpected input: ${Deno.inspect(this.value)} (expectation: ${Deno.inspect(this.expectation)})`;
    }
}

/**
 * A generator function that requests to peek at the next input value.
 */
export function* peek<Input>(): ParserGenerator<Input, Input | EndOfInput> {
    return (yield peekInputRequest) as Input | EndOfInput;
}

/**
 * A generator function that requests to eat (consume) the next input value.
 */
export function* eat<Input>(): ParserGenerator<Input, Input | EndOfInput> {
    return (yield eatInputRequest) as Input | EndOfInput;
}

/**
 * A generator function that requests to take a snapshot of the current input state.
 */
export function* snapshot<Input>(): ParserGenerator<Input, Snapshot> {
    return (yield snapshotRequest) as Snapshot;
}

/**
 * Chains parsing operations allowing composition of multiple parsers.
 */
export interface IParsableChain<Input, Output, Args extends unknown[] = []> extends IParsable<Input, Output, Args> {
    /**
     * Catch errors and apply a fallback parser.
     */
    catch<NextOutput>(nextParsable: IParsable<Input, NextOutput, [ unknown ]> | ((error: unknown) => IParsable<Input, NextOutput, [ unknown ]>)): IParsableChain<Input, Output | NextOutput>;

    /**
     * Chain a subsequent parsing operation.
     */
    then<NextOutput>(nextParsable: IParsable<Input, NextOutput, [ Output ]> | ((output: Output) => IParsable<Input, NextOutput, [ Output ]>)): IParsableChain<Input, NextOutput>;

    /**
     * Encapsulate a parser with begin and end parsers.
     */
    between<Start, End>(start: IParsable<Input, Start>, end: IParsable<Input, End>): IParsableChain<Input, [ Start, Output, End ]>;

    /**
     * Flatten a nested output structure.
     */
    flat<Depth extends number = 1>(depth?: Depth): IParsableChain<Input, FlatArray<Output, Depth>[]>;

    /**
     * Map over the output and transform it.
     */
    map<MappedOutput>(map: (output: Output) => MappedOutput): IParsableChain<Input, MappedOutput>;

    /**
     * Repeat parsing a certain number of times.
     */
    repeat(min?: number, max?: number): IParsableChain<Input, Output[]>;

    /**
     * Marks the parser as fatal, indicating that errors cannot be caught.
     */
    fatal(): IParsableChain<Input, Output>;
}

/**
 * Chains parsers into a more fluent interface.
 */
export const chainable =
    <Input, Output>(parsable: IParsable<Input, Output>)
        : IParsableChain<Input, Output> => ({
        ...parsable,
        /*
         * Extends the existing parser with additional error handling logic.
         *
         * Applies a fallback parsing strategy in case of errors, enabling more robust parsing sequences
         * especially when dealing with optional or variable formats within input data.
         *
         * Useful in constructing parser chains where recovery from certain error conditions is essential,
         * allowing more flexible design of language or protocol parsers.
         */
        catch: <NextOutput>(nextParsable: IParsable<Input, NextOutput, [ unknown ]> | ((error: unknown) => IParsable<Input, NextOutput>)) =>
            chainable(
                {
                    * [Symbol.iterator](): ParserGenerator<Input, Output | NextOutput> {
                        try {
                            return yield* parsable[Symbol.iterator]();
                        } catch (error) {
                            if (error instanceof FatalParserError) {
                                throw error;
                            }

                            if (nextParsable instanceof Function) {
                                return yield* nextParsable(error)[Symbol.iterator]();
                            }

                            return yield* nextParsable[Symbol.iterator](error);
                        }
                    },
                }
            ),
        then: <NextOutput>(nextParsable: IParsable<Input, NextOutput, [ Output ]> | ((output: Output) => IParsable<Input, NextOutput>)) =>
            chainable(
                nextParsable instanceof Function
                    ? {
                        * [Symbol.iterator](): ParserGenerator<Input, NextOutput> {
                            return yield* nextParsable(yield* parsable[Symbol.iterator]())[Symbol.iterator]();
                        },
                    }
                    : {
                        * [Symbol.iterator](): ParserGenerator<Input, NextOutput> {
                            return yield* nextParsable[Symbol.iterator](yield* parsable[Symbol.iterator]());
                        },
                    }
            ),
        between: <Start, End>(start: IParsable<Input, Start>, end: IParsable<Input, End>): IParsableChain<Input, [ Start, Output, End ]> =>
            between(start, parsable, end),
        flat: <Depth extends number = 1>(depth?: Depth) =>
            chainable({
                * [Symbol.iterator](): ParserGenerator<Input, FlatArray<Output, Depth>[]> {
                    return Array.prototype.flat.call(yield* parsable[Symbol.iterator](), depth) as FlatArray<Output, Depth>[];
                },
            }),
        map: <MappedOutput>(map: (output: Output) => MappedOutput) =>
            chainable({
                * [Symbol.iterator](): ParserGenerator<Input, MappedOutput> {
                    return map(yield* parsable[Symbol.iterator]());
                },
            }),
        repeat: (min = 1, max = Infinity) =>
            chainable({
                * [Symbol.iterator](): ParserGenerator<Input, Output[]> {
                    const output: Output[] = [];

                    for (let iter = 0; iter < min; iter++) {
                        output.push(yield* parsable[Symbol.iterator]());
                    }

                    for (let iter = min; iter < max; iter++) {
                        const errorSnapshot = yield* snapshot();

                        try {
                            output.push(yield* parsable[Symbol.iterator]());
                        } catch (error) {
                            if (error instanceof FatalParserError) {
                                throw error;
                            }

                            yield errorSnapshot;
                            break;
                        }
                    }

                    return output;
                },
            }),
        fatal: () => fatal(parsable),
    });

/**
 * Creates a parsable entity that ensures the given input matches the expected equality condition.
 *
 * Useful in scenarios where specific tokens or constants are critical to parsing a particular structure,
 * such as keywords or syntax markers.
 *
 * Applies a user-defined assertion function, which throws upon a mismatch, signaling parsing errors.
 */
export const equals = <Expectation extends Input, Input = Expectation>(expectation: Expectation) =>
    function fn(value: Input): asserts value is Expectation {
        if (value !== expectation) {
            throw new UnexpectedInputError(fn, value, expectation);
        }
    };

/**
 * Validates that the input string matches a given pattern as defined by a regular expression.
 *
 * A common utility for validating lexical structures like identifiers, numbers, or complex tokens
 * transcending simple string equality. Ensures the matching logic remains unified and consistent.
 *
 * Throws an `UnexpectedInputError` if the input pattern does not match.
 */
export const match = (expectation: RegExp) =>
    function fn(value: string | EndOfInput): asserts value is string {
        if (value === EndOfInput || !expectation.test(value)) {
            throw new UnexpectedInputError(fn, value, expectation);
        }
    };

/**
 * Chains the `expect` operation on parsers for composing them with assertions.
 */
export const expect = <Expectation extends Input, Input = Expectation>(test: (value: Input) => asserts value is Expectation): IParsableChain<Exclude<Input, EndOfInput>, Expectation> =>
    ((baseError = new ParserError(expect)) => chainable({
        * [Symbol.iterator](): ParserGenerator<Input, Expectation> {
            try {
                test((yield peekInputRequest) as Input);
                return (yield eatInputRequest) as Expectation;
            } catch (error) {
                if (error instanceof Error) {
                    baseError.cause = error;
                    throw baseError;
                }

                throw error;
            }
        },
    }))();

/**
 * Chains a `fatal` operation on parsers to mark that errors during parsing are fatal.
 */
export const fatal = <Input, Output>(parsable: IParsable<Input, Output>): IParsableChain<Input, Output> =>
    ((baseError = new FatalParserError(expect)) => chainable({
        * [Symbol.iterator](): ParserGenerator<Input, Output> {
            try {
                return yield* parsable;
            } catch (error) {
                if (error instanceof FatalParserError) {
                    throw error;
                }

                baseError.cause = error;
                throw baseError;
            }
        }
    }))();

/**
 * A no-operation parser that returns a predetermined result.
 */
export const noop = <Input, Output>(result: Output): IParsableChain<Input, Output> =>
    chainable({
        // deno-lint-ignore require-yield
        * [Symbol.iterator](): ParserGenerator<Input, Output> {
            return result;
        }
    });

export type SequenceInput<T extends IParsable[]> = { [K in keyof T]: T[K] extends IParsable<infer Input> ? Input : never }[number];
export type SequenceOutput<T extends IParsable[]> = { [K in keyof T]: T[K] extends IParsable<unknown, infer Output> ? Output : never };

/**
 * Sequentially applies a start parser, the main parser, and an end parser.
 * Enforces structure in input by validating encapsulating elements or sections.
 *
 * Commonly used in parsing constructs with fixed structure such as brackets, tags,
 * or blocks of data where an opening and closing delimiter bracket a core structure.
 *
 * Throws `FatalParserError` if start or end parsers fail.
 */
export const sequence = <T extends IParsable[]>(...parable: [ ...T ]): IParsableChain<SequenceInput<T>, SequenceOutput<T>> =>
    chainable({
        * [Symbol.iterator](): ParserGenerator<SequenceInput<T>, SequenceOutput<T>> {
            const results = new Array(parable.length) as SequenceOutput<T>;

            for (let index = 0; index < parable.length; index++) {
                results[index] = yield* parable[index][Symbol.iterator]();
            }

            return results;
        },
    });

export type ChoiceInput<T extends IParsable[]> = { [K in keyof T]: T[K] extends IParsable<infer Input> ? Input : never }[number];
export type ChoiceOutput<T extends IParsable[]> = { [K in keyof T]: T[K] extends IParsable<unknown, infer Output> ? Output : never }[number];

/**
 * Constructs a choice parser that can attempt multiple parsing paths in sequence.
 *
 * Each path is attempted in succession until one succeeds, making it part of adaptive parsing strategies
 * where inputs exhibit considerable variance.
 *
 * If all paths fail, collates errors to provide a detailed failure report.
 */
export const choice = <T extends IParsable[]>(...parsable: [ ...T ]): IParsableChain<ChoiceInput<T>, ChoiceOutput<T>> =>
    ((baseError = new ChoiceParserError(choice)) => chainable({
        * [Symbol.iterator](): ParserGenerator<ChoiceInput<T>, ChoiceOutput<T>> {
            const initialSnapshot = yield* snapshot();

            let furthestError: {
                errors: unknown[],
                snapshot: Snapshot,
            } | undefined;

            for (let index = 0; index < parsable.length; index++) {
                try {
                    return (yield* parsable[index][Symbol.iterator]()) as ChoiceOutput<T>;
                } catch (error) {
                    if (error instanceof FatalParserError) {
                        throw error;
                    }

                    const errorSnapshot = yield* snapshot();

                    if ((furthestError?.snapshot.index ?? -1) <= errorSnapshot.index) {
                        furthestError = {
                            errors: [ ...furthestError?.errors ?? [], error ],
                            snapshot: errorSnapshot,
                        };
                    }

                    yield initialSnapshot;
                }
            }

            yield furthestError!.snapshot;

            if (furthestError!.errors.length === 1) {
                throw furthestError!.errors[0];
            }

            baseError.errors = furthestError!.errors;
            throw baseError;
        },
    }))();

/**
 * Creates a parser that applies start, body, and end parsers sequentially.
 */
const between = <Input, Start, Body, End>(
    start: IParsable<Input, Start>,
    body: IParsable<Input, Body>,
    end: IParsable<Input, End>,
): IParsableChain<Input, [ Start, Body, End ]> =>
    sequence(start, fatal(body), fatal(end));
