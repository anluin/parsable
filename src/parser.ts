const PeekInput: unique symbol = Symbol();
type PeekInput = typeof PeekInput;

const EatInput: unique symbol = Symbol();
type EatInput = typeof EatInput;

export const EndOfInput: unique symbol = Symbol();
export type EndOfInput = typeof EndOfInput;

export type ParserRequest<Input> = PeekInput | EatInput | typeof Snapshot | Snapshot<Input>;
export type ParserResponse<Input> = Input | EndOfInput | Snapshot<Input>;
export type ParserGenerator<Input, Output> = Generator<ParserRequest<Input>, Output, ParserResponse<Input>>;

export class Snapshot<Input = unknown, Output = unknown> {
    constructor(
        readonly state: ParserState<Input, Output>,
        readonly cursor: number = state.cursor,
    ) {
    }
}

export function* peekInput<Input>(): ParserGenerator<Input, Input | EndOfInput> {
    return (yield PeekInput) as Exclude<ParserResponse<Input>, Snapshot<Input>>;
}

export function* eatInput<Input>(): ParserGenerator<Input, Input | EndOfInput> {
    return (yield EatInput) as Exclude<ParserResponse<Input>, Snapshot<Input>>;
}

export function* createSnapshot<Input>(): ParserGenerator<Input, Snapshot<Input>> {
    return (yield Snapshot) as Snapshot<Input>;
}

export interface Hooks<Input, Output> {
    onConsumption?(input: Input): void;
    onRollback?(inputs: Input[]): void;
    onReturn?(output: Output): void;
}

export interface Parsable<Input, Output, Args extends unknown[] = []> {
    [Symbol.iterator](...args: Args): ParserGenerator<Input, Output>;
}

export type ParserState<Input, Output> = {
    generator: ParserGenerator<Input, Output>,
    result: IteratorYieldResult<ParserRequest<Input>>,
    cursor: number,
};

export type ParserParseOptions = {
    stream?: boolean,
};

export class Parser<Input, Output> {
    readonly #parsable: Parsable<Input, Output>;
    readonly #hooks?: Hooks<Input, Output>;
    readonly #buffer: Input[] = [];

    #state?: ParserState<Input, Output>;

    constructor(parsable: Parsable<Input, Output>, hooks?: Hooks<Input, Output>) {
        this.#parsable = parsable;
        this.#hooks = hooks;
    }

    * #process(): Generator<Output> {
        if (!this.#state) {
            const generator = this.#parsable[Symbol.iterator]();
            const result = generator.next();

            if (result.done) {
                throw new TypeError("Given parser has not consumed any input");
            }

            this.#state = {generator, result, cursor: 0};
        }

        const request: ParserRequest<Input> = this.#state.result.value;
        let result: IteratorResult<ParserRequest<Input>>;

        if (request === Snapshot) {
            result = this.#state.generator.next(new Snapshot(this.#state));
        } else if (request instanceof Snapshot) {
            if (request.state !== this.#state) throw new Error();
            this.#hooks?.onRollback?.(this.#buffer.slice(request.cursor, this.#state.cursor));
            this.#state.cursor = request.cursor;
            result = this.#state.generator.next(request);
        } else if (this.#state.cursor < this.#buffer.length) {
            const item = this.#buffer[this.#state.cursor];

            if (request === EatInput) {
                this.#hooks?.onConsumption?.(item);
                this.#state.cursor++;
            }

            result = this.#state.generator.next(item);
        } else {
            result = this.#state.generator.next(EndOfInput);
        }

        if (result.done) {
            if (this.#buffer.splice(0, this.#state.cursor).length === 0) {
                throw new TypeError("Given parser has not consumed any input");
            }

            this.#hooks?.onReturn?.(result.value);
            this.#state = undefined;
            yield result.value;
        } else {
            this.#state.result = result;
        }
    }

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
}

export class ParserStream<Input, Output> extends TransformStream<Iterable<Input>, Array<Output>> {
    constructor(
        parsable: Parsable<Input, Output>,
        writableStrategy?: QueuingStrategy<Iterable<Input>>,
        readableStrategy?: QueuingStrategy<Array<Output>>,
    ) {
        const parser = new Parser(parsable);

        super(
            {
                transform: (chunk, controller) => {
                    const outputs = Array.from(parser.parse(chunk, {stream: true}));
                    if (outputs.length > 0) controller.enqueue(outputs);
                },
                flush: (controller) => {
                    const outputs = Array.from(parser.parse([], {stream: false}));
                    if (outputs.length > 0) controller.enqueue(outputs);
                },
            },
            writableStrategy,
            readableStrategy,
        );
    }
}
