const options = { disableValidation: false }
const otherOptions = { validate: true }
Effect.catch(error => recover(error))
Other.catchCause(handler)
Schema.Option(value)
Other.OptionFromSelf(value)
Schema.decodeUnknownEffect(value)
Other.decodeUnknownSync(value)
Option.fromNullishOr(value)
value === null ? Option.none() : Option.some(value)

export { options, otherOptions }
