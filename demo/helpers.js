'use strict';
// t(customer, category, subject, message, minutesAgo, state, reply, extras)
//   state: 'new' (nobody has replied yet), 'bot' (the assistant answered), 'agent' (a person replied
//   and is waiting on the customer) or 'resolved'. extras: { pri, custom, followup, after }
const t = (who, cat, subject, body, mins, kind = 'new', reply = '', extra = {}) => ({ who, cat, subject, body, mins, kind, reply, ...extra });
module.exports = { t };
