'use strict';
// Every file in this folder exports a list of made-up companies for one kind of service.
// All names, people, places and numbers are fictional.
const KINDS = ['general', 'academic', 'tech', 'social', 'ecommerce', 'health', 'finance', 'food', 'travel', 'legal'];
const forCompany = require('./playbooks').forCompany;
module.exports = KINDS.flatMap((k) => require(`./${k}`).map((c) => {
  const company = { ...c, niche: k };
  return { ...company, docs: [...company.docs, ...forCompany(company)] };
}));
