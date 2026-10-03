function named(name: string) {
  return class extends Error {
    constructor(message = name) { super(message); this.name = name; }
  };
}
export class InvalidProposal extends named('InvalidProposal') {}
export class NotApproved extends named('NotApproved') {}
export class HashMismatch extends named('HashMismatch') {}
export class BudgetExhausted extends named('BudgetExhausted') {}
export class AgentFailed extends named('AgentFailed') {}
export class IllegalTransition extends named('IllegalTransition') {}
export class NotFound extends named('NotFound') {}
