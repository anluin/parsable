import { eatInput, peekInput, EndOfInput, createSnapshot } from "./parser.ts";
import type { ParserGenerator, Parsable, Snapshot } from "./parser.ts";


export interface ChainableParsable<Input, Output> extends Parsable<Input, Output> {
    repeat(min?: number, max?: number): ChainableParsable<Input, Output[]>;
    map<MappedOutput>(map: (output: Output) => MappedOutput): ChainableParsable<Input, MappedOutput>;
    next<NextOutput>(nextParsable: Parsable<Input, NextOutput>): ChainableParsable<Input, [ Output, NextOutput ]>;
    then<NextOutput>(nextParsable: Parsable<Input, NextOutput, [ Output ]> | ((output: Output) => Parsable<Input, NextOutput>)): ChainableParsable<Input, NextOutput>;
    catch<NextOutput>(nextParsable: Parsable<Input, NextOutput, [ unknown ]> | ((error: unknown) => Parsable<Input, NextOutput>)): ChainableParsable<Input, Output | NextOutput>;
}

export const chainable =
    <Input, Output>(parsable: Parsable<Input, Output>)
        : ChainableParsable<Input, Output> => ({
        ...parsable,
        repeat: () => chainable({
            * [Symbol.iterator](min = 1, max = Infinity): ParserGenerator<Input, Output[]> {
                const output: Output[] = [];

                for (let iter = 0; iter < min; iter++) {
                    output.push(yield* parsable[Symbol.iterator]());
                }

                for (let iter = min; iter < max; iter++) {
                    const snapshot = yield* createSnapshot();

                    try {
                        output.push(yield* parsable[Symbol.iterator]());
                    } catch (_error) {
                        // TODO: Handle fatal errors

                        yield snapshot;
                        break;
                    }
                }

                return output;
            },
        }),
        map: <MappedOutput>(map: (output: Output) => MappedOutput) => chainable({
            * [Symbol.iterator](): ParserGenerator<Input, MappedOutput> {
                return map(yield* parsable[Symbol.iterator]());
            },
        }),
        next: <NextOutput>(nextParsable: Parsable<Input, NextOutput>) => chainable({
            * [Symbol.iterator](): ParserGenerator<Input, [ Output, NextOutput ]> {
                return [ yield* parsable[Symbol.iterator](), yield* nextParsable ];
            },
        }),
        then: <NextOutput>(nextParsable: Parsable<Input, NextOutput, [ Output ]> | ((output: Output) => Parsable<Input, NextOutput>)) => chainable(
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
        catch: <NextOutput>(nextParsable: Parsable<Input, NextOutput, [ unknown ]> | ((error: unknown) => Parsable<Input, NextOutput>)) => chainable(
            {
                * [Symbol.iterator](): ParserGenerator<Input, Output | NextOutput> {
                    try {
                        return yield* parsable[Symbol.iterator]();
                    } catch (error) {
                        // TODO: Handle fatal errors

                        if (nextParsable instanceof Function) {
                            return yield* nextParsable(error)[Symbol.iterator]();
                        }

                        return yield* nextParsable[Symbol.iterator](error);
                    }
                },
            }
        ),
    });

export const equals = <Input extends Expectation, Output, Expectation extends Output>(expectation: Expectation): ChainableParsable<Input, Expectation> =>
    chainable({
        * [Symbol.iterator](): ParserGenerator<Input, Expectation> {
            const input = yield* peekInput();

            if (input === expectation) {
                return (yield* eatInput()) as Expectation;
            }

            throw new Error();
        },
    });

export const match = (regExp: RegExp): ChainableParsable<string, string> =>
    chainable({
        * [Symbol.iterator](): ParserGenerator<string, string> {
            const input = yield* peekInput();

            if (input !== EndOfInput && regExp.test(input)) {
                return (yield* eatInput()) as string;
            }

            throw new Error();
        },
    });

export type SequenceInput<T extends Parsable<unknown, unknown>[]> = { [K in keyof T]: T[K] extends Parsable<infer Input, unknown> ? Input : never }[number];
export type SequenceOutput<T extends Parsable<unknown, unknown>[]> = { [K in keyof T]: T[K] extends Parsable<unknown, infer Output> ? Output : never };

export const sequence = <Parsables extends (Parsable<unknown, unknown>)[]>(...parable: [ ...Parsables ]): ChainableParsable<{ [K in keyof Parsables]: Parsables[K] extends Parsable<infer Input, unknown> ? Input : never }[number], Array<Parsable<unknown, unknown> extends Parsable<unknown, infer Output> ? Output : never>> =>
    chainable({
        * [Symbol.iterator](): ParserGenerator<SequenceInput<Parsables>, SequenceOutput<Parsables>> {
            const results = new Array(parable.length) as SequenceOutput<Parsables>;

            for (let index = 0; index < parable.length; index++) {
                results[index] = yield* parable[index][Symbol.iterator]();
            }

            return results;
        },
    });

export type ChoiceInput<T extends Parsable<unknown, unknown>[]> = { [K in keyof T]: T[K] extends Parsable<infer Input, unknown> ? Input : never }[number];
export type ChoiceOutput<T extends Parsable<unknown, unknown>[]> = { [K in keyof T]: T[K] extends Parsable<unknown, infer Output> ? Output : never }[number];

export const choice = <Parsables extends (Parsable<unknown, unknown>)[]>(...parsable: [ ...Parsables ]): ChainableParsable<{ [K in keyof Parsables]: Parsables[K] extends Parsable<infer Input, unknown> ? Input : never }[number], { [K in keyof Parsables]: Parsables[K] extends Parsable<unknown, infer Output> ? Output : never }[number]> =>
    chainable({
        * [Symbol.iterator](): ParserGenerator<ChoiceInput<Parsables>, ChoiceOutput<Parsables>> {
            const initialSnapshot = yield* createSnapshot();

            let furthestError: {
                snapshot: Snapshot,
                errors: unknown[],
            } | undefined;

            for (let index = 0; index < parsable.length; index++) {
                try {
                    return (yield* parsable[index][Symbol.iterator]()) as ChoiceOutput<Parsables>;
                } catch (error) {
                    // TODO: Handle fatal errors
                    const snapshot = yield* createSnapshot();

                    if ((furthestError?.snapshot.cursor ?? -1) <= snapshot.cursor) {
                        furthestError = {
                            snapshot,
                            errors: [
                                ...furthestError?.errors ?? [],
                                error,
                            ],
                        };
                    }

                    yield initialSnapshot;
                }
            }

            yield furthestError!.snapshot;

            if (furthestError!.errors.length === 1) {
                throw furthestError!.errors[0];
            }

            throw new AggregateError(furthestError!.errors);
        },
    });

export const noop = <Output = undefined>(output?: Output): ChainableParsable<unknown, Output> =>
    chainable(({
        // deno-lint-ignore require-yield
        * [Symbol.iterator](): ParserGenerator<unknown, Output> {
            return output as Output;
        }
    }));
