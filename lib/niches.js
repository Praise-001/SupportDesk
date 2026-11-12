'use strict';
// Niche templates: a starting set of ticket categories (and extra form fields) per kind of business.
// Owners pick one at sign-up (or later) and can edit everything afterwards.

const f = (key, label, type = 'text', required = false) => ({ key, label, type, required });

const NICHES = {
  general: {
    label: 'General / all-purpose',
    description: 'A neutral setup that works for any kind of business.',
    categories: [
      { name: 'Question', description: 'General questions', fields: [] },
      { name: 'Bug / Something broken', description: 'Something is not working', fields: [] },
      { name: 'Billing', description: 'Payments, invoices and refunds', fields: [f('reference', 'Invoice or payment reference')] },
      { name: 'Account', description: 'Login and account help', fields: [] },
      { name: 'Feature request', description: 'Ideas and suggestions', fields: [] },
      { name: 'Other', description: 'Anything else', fields: [] },
    ],
  },
  academic: {
    label: 'Academic / Campus',
    description: 'Schools, universities and campus services.',
    categories: [
      { name: 'Admissions', description: 'Applications and enrolment', fields: [f('applicant_id', 'Applicant ID')] },
      { name: 'Course registration', description: 'Add, drop and timetable issues', fields: [f('student_id', 'Student ID'), f('course_code', 'Course code')] },
      { name: 'Fees & financial aid', description: 'Tuition, scholarships and payments', fields: [f('student_id', 'Student ID')] },
      { name: 'Exams & grades', description: 'Results, re-marks and exam schedules', fields: [f('student_id', 'Student ID'), f('course_code', 'Course code')] },
      { name: 'Accommodation', description: 'Hostels and housing', fields: [f('student_id', 'Student ID')] },
      { name: 'IT & campus portal', description: 'Wi-Fi, email and portal access', fields: [] },
      { name: 'Library & resources', description: 'Books, journals and study spaces', fields: [] },
      { name: 'Other', description: 'Anything else', fields: [] },
    ],
  },
  tech: {
    label: 'Tech / SaaS',
    description: 'Software products, apps and developer tools.',
    categories: [
      { name: 'Bug report', description: 'Something is broken', fields: [f('app_version', 'App version'), f('platform', 'Device / browser')] },
      { name: 'How-to question', description: 'Help using the product', fields: [] },
      { name: 'Account & login', description: 'Sign-in, passwords and access', fields: [] },
      { name: 'Billing & plans', description: 'Subscriptions, invoices and upgrades', fields: [f('workspace', 'Workspace / account name')] },
      { name: 'Integrations & API', description: 'API keys, webhooks and integrations', fields: [] },
      { name: 'Security', description: 'Security concerns and data requests', fields: [] },
      { name: 'Feature request', description: 'Ideas for the product', fields: [] },
    ],
  },
  social: {
    label: 'Social / Entertainment',
    description: 'Communities, events, streaming, gaming and creators.',
    categories: [
      { name: 'Account & profile', description: 'Profile, login and username issues', fields: [f('username', 'Username')] },
      { name: 'Report content or user', description: 'Abuse, spam and safety reports', fields: [f('link', 'Link to the content')] },
      { name: 'Tickets & events', description: 'Event tickets, entry and refunds', fields: [f('booking_ref', 'Booking reference')] },
      { name: 'Subscriptions & payments', description: 'Memberships and payment problems', fields: [] },
      { name: 'Playback & app issues', description: 'Streaming, game or app problems', fields: [f('platform', 'Device / platform')] },
      { name: 'Creator & partnership', description: 'Collaborations and creator support', fields: [] },
      { name: 'Other', description: 'Anything else', fields: [] },
    ],
  },
  ecommerce: {
    label: 'Online store / E-commerce',
    description: 'Shops selling physical or digital products.',
    categories: [
      { name: 'Where is my order?', description: 'Shipping and delivery tracking', fields: [f('order_number', 'Order number', 'text', true)] },
      { name: 'Damaged or wrong item', description: 'Item arrived damaged or incorrect', fields: [f('order_number', 'Order number', 'text', true)] },
      { name: 'Returns & refunds', description: 'Return requests and refund status', fields: [f('order_number', 'Order number', 'text', true)] },
      { name: 'Payments', description: 'Failed or duplicate charges', fields: [f('order_number', 'Order number')] },
      { name: 'Product question', description: 'Sizes, stock and details', fields: [f('product_sku', 'Product or SKU')] },
      { name: 'Account', description: 'Login and address changes', fields: [] },
    ],
  },
  health: {
    label: 'Health / Clinic',
    description: 'Clinics, pharmacies and wellness services. Not for emergencies.',
    categories: [
      { name: 'Appointments', description: 'Book, move or cancel appointments', fields: [f('preferred_date', 'Preferred date')] },
      { name: 'Billing & insurance', description: 'Invoices and insurance claims', fields: [f('policy_number', 'Policy number')] },
      { name: 'Prescriptions & refills', description: 'Refill requests and pharmacy questions', fields: [] },
      { name: 'Test results & records', description: 'Records and result enquiries', fields: [] },
      { name: 'Services & opening hours', description: 'What you offer and when', fields: [] },
      { name: 'Feedback & complaints', description: 'Tell us about your experience', fields: [] },
    ],
  },
  finance: {
    label: 'Finance / Banking',
    description: 'Banks, fintech, insurance and payments.',
    categories: [
      { name: 'Card & payments', description: 'Declined payments, lost cards', fields: [f('last4', 'Last 4 digits of card')] },
      { name: 'Transfers', description: 'Delayed or failed transfers', fields: [f('transfer_ref', 'Transfer reference')] },
      { name: 'Account access', description: 'Login, limits and verification', fields: [] },
      { name: 'Fraud & disputes', description: 'Suspicious activity and chargebacks', fields: [f('transaction_ref', 'Transaction reference')] },
      { name: 'Loans & credit', description: 'Applications and repayments', fields: [] },
      { name: 'Statements & fees', description: 'Statements, fees and charges', fields: [] },
    ],
  },
  food: {
    label: 'Food / Hospitality',
    description: 'Restaurants, food brands, delivery and hotels.',
    categories: [
      { name: 'Order issue', description: 'Missing, late or wrong items', fields: [f('order_number', 'Order number')] },
      { name: 'Reservations & bookings', description: 'Tables, rooms and events', fields: [f('booking_ref', 'Booking reference'), f('party_size', 'Party size', 'number')] },
      { name: 'Allergens & ingredients', description: 'Dietary and allergen questions', fields: [] },
      { name: 'Refunds & payments', description: 'Charges and refund requests', fields: [f('order_number', 'Order number')] },
      { name: 'Catering & bulk orders', description: 'Large orders and events', fields: [] },
      { name: 'Feedback', description: 'Compliments and complaints', fields: [] },
    ],
  },
  travel: {
    label: 'Travel / Transport',
    description: 'Airlines, tours, bookings and transport services.',
    categories: [
      { name: 'Booking changes', description: 'Change dates, names or routes', fields: [f('booking_ref', 'Booking reference', 'text', true)] },
      { name: 'Cancellations & refunds', description: 'Cancel a trip or request a refund', fields: [f('booking_ref', 'Booking reference', 'text', true)] },
      { name: 'Delays & disruptions', description: 'Delayed, cancelled or rerouted trips', fields: [f('booking_ref', 'Booking reference')] },
      { name: 'Baggage & lost items', description: 'Lost, delayed or damaged baggage', fields: [f('booking_ref', 'Booking reference')] },
      { name: 'Documents & visas', description: 'Travel documents and requirements', fields: [] },
      { name: 'Other', description: 'Anything else', fields: [] },
    ],
  },
  legal: {
    label: 'Legal / Professional services',
    description: 'Law firms, consultancies and agencies.',
    categories: [
      { name: 'New enquiry', description: 'Prospective client enquiries', fields: [] },
      { name: 'Existing matter', description: 'Updates on an ongoing matter', fields: [f('matter_ref', 'Matter / case reference')] },
      { name: 'Billing & invoices', description: 'Invoices and payment questions', fields: [f('invoice_number', 'Invoice number')] },
      { name: 'Documents & signing', description: 'Sending or signing documents', fields: [f('matter_ref', 'Matter / case reference')] },
      { name: 'Appointments', description: 'Book or change consultations', fields: [] },
      { name: 'Complaints', description: 'Feedback about our service', fields: [] },
    ],
  },
};

const BOT_NAME_SUGGESTIONS = ['Maya', 'Alex', 'Sam', 'Nora', 'Leo', 'Ivy', 'Kai', 'Zara'];

function listNiches() {
  return Object.entries(NICHES).map(([key, n]) => ({
    key,
    label: n.label,
    description: n.description,
    categories: n.categories.map((c) => c.name),
  }));
}

module.exports = { NICHES, BOT_NAME_SUGGESTIONS, listNiches };
