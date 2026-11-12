'use strict';

// Practical, source-linked support procedures shared by the fictional demo desks.
// Company names are inserted so each desk receives its own tailored documents.
const PLAYBOOKS = {
  general: [
    ['First checks for service, account and payment problems', `Use this guide for ${'{company}'} requests about access, a service that is not working, a delayed request, or an unexpected charge. Start with the least disruptive checks and give one short set of steps at a time.

Account access: confirm the customer is using the sign-in method and email address they originally registered. Ask them to use the official password reset link, open the newest reset message, and check spam if it is missing. Never ask for a password, one-time code, recovery phrase or full payment-card number. If recovery requires checking identity or changing account records, a staff member must handle it through the approved secure process.

Something is not working: ask what they expected, what happened instead, the exact visible error, and whether it happens on another browser/device or network. Have them reload once, sign out and back in, then try a private window or another supported browser. Save any unsent work before clearing browser data. If the service fails on multiple devices or networks, stop repeating local resets and check for a service outage or escalate to the service owner.

Payment or invoice question: ask the customer to compare the date, amount, merchant description and status in their own bank or payment app with the receipt in ${'{company}'}. A pending authorisation can differ from a settled charge. Do not promise a refund or claim a payment succeeded without looking up the transaction in a verified account. If a charge is unrecognised, tell the customer to contact their bank or card issuer promptly using the number on the card or official website.

If the first route does not work, offer a second route: try another supported device/network, use the official recovery or payment provider channel, or provide the non-secret error text and approximate time. If the same issue persists after both routes, or private account records/actions are required, pass it to the team. Ask for only the relevant reference through this secure ticket; never request credentials or security codes.

Sources: Google Account recovery guidance https://support.google.com/accounts/answer/7682439 ; CFPB on unauthorized transactions https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-my-money-back-after-i-discover-an-unauthorized-transaction-or-money-missing-from-my-bank-account-en-1017/`],
    ['Safe triage, evidence and escalation', `For ${'{company}'}, keep troubleshooting useful and privacy-safe. First restate the issue in plain language and ask one focused question if an important fact is missing. Then provide numbered steps the customer can try without sharing private records. Explain what to expect after each step and give a reasonable alternative if it fails.

Useful diagnostic details are the device type, app or browser version, approximate time, exact error wording, affected feature and whether other devices are affected. A screenshot may help only after the customer hides names, email addresses, balances, addresses, tokens and other personal information. Never ask customers to post passwords, one-time codes, PINs, CVV, recovery phrases, full card/account numbers, identity documents or private medical/legal documents in a public or ordinary support message.

For a suspected scam or compromised account, advise the customer not to reply, click links or send money. They should open the official app/site themselves, secure the account using the provider's recovery route, and contact the relevant institution from a trusted number. If money, access or private data may be at risk, notify a human team promptly; do not delay urgent containment while repeating routine steps.

Use this handoff sequence for ordinary problems: (1) give the best matching checklist; (2) if it fails, ask which step failed and offer the next safe option; (3) if that option also fails, or an authenticated lookup/change is needed, summarize the attempts and route the case to a person. If the customer explicitly asks for a person, honor that request. For immediate danger, direct them to local emergency services first.

Sources: FTC account-recovery guidance https://consumer.ftc.gov/articles/how-recover-your-hacked-email-or-social-media-account ; CFPB fraud guidance https://www.consumerfinance.gov/ask-cfpb/what-is-a-fraud-alert-en-1777/`],
  ],
  academic: [
    ['Student portal, sign-in and submission troubleshooting', `This procedure is tailored to ${'{company}'} student services. First identify whether the problem is sign-in, course access, registration, or submitting work; these need different fixes.

Sign-in: check that the student selected the school-managed account rather than a personal account, and confirm the email spelling and active internet connection. Sign out of other accounts, reopen the official portal in a private window, and sign in with the institution account. Use the school's password-reset route. If access is blocked by enrolment status, an account hold, or an administrator setting, do not guess at the student's record; ask for a student/application reference in the secure ticket and send it to authorised staff. Never request a password or verification code.

File or assignment submission: save a local copy of the work first. Check that the file type and size are allowed, use a stable connection, rename the file using simple characters, then try uploading from a desktop browser or the school's approved cloud drive. Reopen the assignment and confirm that a submitted/turned-in status appears; an upload alone may not be final submission. Keep a timestamped screenshot with personal details hidden.

If the portal route fails, try the supported browser/device or the institution's approved alternate submission path. Do not promise an extension or alter a grade. If a deadline is close, advise the student to email the instructor from their school account with the assignment name, time of attempt and redacted error screenshot, then route the case to the appropriate school team.

Source: Google Classroom student troubleshooting https://support.google.com/edu/classroom/answer/6315899 ; assignment submission steps https://support.google.com/edu/classroom/answer/6020285`],
    ['Registration, learning resources and records', `When a ${'{company}'} student reports registration, timetable, library or grade trouble, separate general guidance from actions that require the student's record.

Registration and timetable: ask for the term, course code and the exact message shown. Have the student check the registration calendar, prerequisites, timetable conflicts and whether the course is full. Refresh the portal and try another supported browser. Do not add/drop a course, override a prerequisite, confirm a seat, or interpret a personal academic standing without authorised access. If the portal blocks a normal step, collect the course code and non-secret error text and route the request to the registrar/adviser.

Library or learning resources: confirm the student is signed in with the institutional account and has selected the correct library location/resource. Try the catalogue title or DOI in quotation marks, remove filters, and check whether the item is available online or at another branch. If access to an electronic journal is denied, note the title, link, course and error; library staff can verify subscription or eligibility. Do not tell the student to bypass access controls.

Grades and official records: explain the published review or records-request process only when it is in the school's knowledge base. Never infer a grade, change a record, promise an appeal outcome, or ask for a full identity document in chat. Request only a student reference and course code using the approved secure route. If a deadline is imminent, advise the student to contact the named instructor/office directly as well as filing the support request.

If the first portal or catalogue route fails, offer the official alternate channel (instructor, adviser, registrar or librarian). If a staff-only record lookup or override is required, pass it on with the troubleshooting already tried.

Source: Google Classroom sign-in help https://support.google.com/edu/classroom/answer/6072460`],
  ],
  tech: [
    ['App, device and connectivity troubleshooting', `For a product from ${'{company}'}, begin with reversible checks and identify the scope before suggesting a reset. Ask for the device/OS, app or browser version, exact error, when it began and whether one feature or all features fail. Do not ask for passwords, API secrets, access tokens, private keys or recovery codes.

Sign-in: confirm the correct workspace/account and sign-in provider; check the service status page if available; then use the official password recovery flow. Try a private window and disable extensions only for a brief test. If multi-factor recovery, account ownership or workspace membership must be verified, route to authorised support.

App/web error: save work, reload once, sign out/in, update to a supported app/browser version, and try a private window or a second supported device. Record a redacted screenshot and exact timestamp. If only one network fails, try another trusted network. If several users or devices fail at once, avoid telling everyone to reinstall; check incident status and escalate with the affected feature and error details.

For Wi-Fi-dependent devices, confirm Wi-Fi is on, airplane mode is off, the device is in range, and another device can reach the internet. Restart the router only if the customer controls it and understands other household devices will disconnect briefly. Avoid factory reset until settings and local data are backed up; it is a last resort.

If these checks fail, offer the alternate supported browser/device or official status/support route. After a second unsuccessful path, or if the fix requires inspecting a customer's private workspace/device telemetry, route to a person with the safe diagnostics gathered.

Sources: Apple Wi-Fi troubleshooting https://support.apple.com/en-us/111786 ; Google account recovery https://support.google.com/accounts/answer/7682439`],
    ['Integrations, API and security incident triage', `Use this guide for ${'{company}'} integrations, webhooks, developer tools and account security. Never ask the customer to paste an API key, bearer token, private key, password or full request containing secrets into a support conversation.

Integration not receiving events: verify the endpoint URL and event type in the customer's own configuration, confirm the destination returns the expected success response, and compare the event timestamp and delivery status in the provider dashboard. Check whether the endpoint is publicly reachable over HTTPS and whether a recent deployment changed authentication, routing or firewall rules. Retry with a harmless test event if available. Preserve the event/request ID, timestamp, status code and a redacted response body.

API request failing: confirm the documented base URL, HTTP method, required headers, parameter names and current API version. Check clock skew, rate-limit response headers, payload schema and whether the credential has the needed scope—without displaying the credential. Rotate a suspected exposed key in the official dashboard and update the secret store; do not send the replacement key to support.

If one credential or workspace behaves differently from a general setup, a human may need to inspect its access scopes or event logs. Route after the customer has tried the documented configuration checks, or immediately for an exposed credential or active compromise. Include only redacted request IDs and the exact error.

Sources: Google Cloud API troubleshooting https://cloud.google.com/apis/docs/troubleshooting ; FTC account-security guidance https://consumer.ftc.gov/articles/how-recover-your-hacked-email-or-social-media-account`],
  ],
  social: [
    ['Account access, profile and content reporting', `For ${'{company}'} community or entertainment accounts, first separate login recovery from a moderation/safety report.

Login: confirm the correct email/username and sign-in provider; use the service's official recovery link, check spam for the newest message, and avoid links from unsolicited messages. If the recovery email/phone has been changed or the account is posting without permission, use the official compromised-account flow from a trusted device. Warn contacts not to click suspicious messages. Never request a password or one-time code.

App or playback issue: update the app, restart it, test a different connection, sign out/in and try a supported browser/device. If audio/video is affected, check mute, volume, output device and whether another title works. Record the title/event, device, app version, time and redacted error. If only one item is unavailable, it may be a rights/availability issue; do not promise access without checking the service's published catalog.

For abuse, impersonation, harassment or unsafe content, preserve the URL/profile identifier and time, use the in-product report/block tools, and do not engage with the account. If there is an immediate threat, contact local emergency services. A human moderator should review credible threats, targeted harassment, compromised accounts, or decisions that require private moderation evidence.

If normal recovery or playback checks do not work, offer the official web route or another supported device. If it still fails, pass along the redacted error and attempted steps.

Sources: FTC hacked social account recovery https://consumer.ftc.gov/articles/how-recover-your-hacked-email-or-social-media-account ; Google account recovery https://support.google.com/accounts/answer/7682439`],
    ['Events, tickets, subscriptions and community safety', `When a ${'{company}'} event or membership issue needs a booking-specific lookup, give the customer a public self-check first, then hand off if the actual record is needed.

Ticket not visible: sign into the account used at checkout, check the confirmation email and spam folder, and search by event name/date. Verify that the payment is completed rather than pending, and check whether the ticket is in a separate wallet/app. Do not ask for card numbers or one-time codes. If the ticket remains missing, request the booking reference through the secure ticket and have staff verify the order.

Event changed or cancelled: point the customer to the event's official notice and the published terms in this company's knowledge base. Avoid promising a refund, replacement seat or entry exception. If the event has passed or the booking record is inconsistent, pass it to the ticketing team.

Subscription/payment: check the plan page and receipt for renewal date, account and payment status. If charged twice, compare posted transactions (not pending authorisations) and report the dates/amounts through the secure route. Do not cancel, refund or disclose another member's account without verification.

For community reports, use block/report tools and capture the content link; a human should review safety reports and appeals. If the customer tried the official route and still cannot access their event/account, escalate with the event, approximate purchase date and reference only.

Sources: FTC hacked social-account recovery https://consumer.ftc.gov/articles/how-recover-your-hacked-email-or-social-media-account ; FTC online-shopping guidance https://consumer.ftc.gov/consumer-alerts/2023/04/shopping-online-heres-what-do-when-things-go-wrong`],
  ],
  ecommerce: [
    ['Order tracking, delivery and item problems', `This guide is for orders placed with ${'{company}'}. Ask for the order number only through the approved secure ticket; never request a full card number, password or one-time code.

Tracking not moving: open the order confirmation or the carrier's official website/app directly and enter the tracking number there. Check the latest scan, expected delivery range, address and whether the parcel is held for pickup. A label-created status can mean the carrier has not scanned the parcel yet. If the delivery estimate has passed, collect the order reference, carrier and latest scan time so staff can contact the carrier.

Marked delivered but missing: check the delivery photo/location if available, mailbox, building desk, household members and a safe alternate drop spot. Confirm the saved delivery address in the customer's account. Avoid clicking delivery-fee texts; visit the retailer/carrier site independently. If still missing after the carrier's stated scan window, report it to ${'{company}'} so staff can open a trace.

Wrong or damaged item: keep the packaging and take clear photos of the outer box, shipping label with address hidden, and item damage. Do not use a damaged electrical or safety product. Review the published return instructions before shipping anything back; do not promise an outcome or refund until staff verify the order and policy.

If tracking checks fail, offer the carrier's official contact/claim path and ${'{company}'} order lookup. If the parcel, refund or replacement requires private order details, pass it to an agent with the reference and steps already tried.

Sources: USPS tracking status help https://faq.usps.com/articles/FAQ/Where-is-my-package ; FTC delivery-text scam warning https://consumer.ftc.gov/consumer-alerts/2025/04/think-text-message-usps-it-could-be-scam`],
    ['Returns, refunds, checkout and product questions', `For ${'{company}'} returns or checkout issues, distinguish a published policy question from an order-specific decision.

Return eligibility: ask the customer to check the order date, item condition and the current return window shown on the order/policy page. Keep tags, packaging and proof of purchase; do not ship a return to an address from an unsolicited message. If the policy permits, use the official returns portal and save the confirmation. A human must verify exceptions, final-sale items, warranty claims or a return that the portal rejects.

Refund not visible: confirm the return or cancellation status in the official order page and check whether the original payment is pending or settled. Refund timing depends on the payment provider and bank; do not promise an exact posting date unless this company's policy states it. If the stated window passed, provide the order reference and refund confirmation ID privately so staff can check the payment record.

Checkout failure: verify billing/shipping fields, try a supported browser, disable autofill for one attempt, and use another payment method only if the customer chooses. Do not ask them to repeat a charge if a payment is pending; first check for an order confirmation. If a duplicate posted charge appears, contact the bank/payment provider and ${'{company}'} through official channels.

Product fit or compatibility: ask for the product name/model and the other device/item it must work with. Compare only with specifications in this company's catalog. If compatibility is not documented, say so and ask staff to verify rather than guess.

Sources: FTC online shopping problem guide https://consumer.ftc.gov/consumer-alerts/2023/04/shopping-online-heres-what-do-when-things-go-wrong ; FTC purchase protections https://consumer.ftc.gov/articles/online-shopping`],
  ],
  health: [
    ['Appointments, prescriptions and test-result access', `This customer-support guide is for ${'{company}'}. It helps with service navigation; it is not a diagnosis or substitute for a clinician.

Appointment issue: check the confirmation message, date/time zone, clinic/location and whether the visit is in-person or remote. Try the official booking link in a current browser. If the booking is missing, cancelled unexpectedly or the patient needs a change, ask for the appointment reference through the secure patient channel; staff must inspect the schedule before confirming.

Prescription/refill: explain only the clinic's published refill route. Ask the patient to check the medication name, pharmacy and remaining supply in their own record. Do not recommend changing a dose, stopping medication, using someone else's medicine or taking extra doses. Clinical suitability and authorisation require a licensed clinician; route those questions to the care team. For a potentially dangerous reaction or overdose, contact local emergency/poison services now.

Test result/record: guide the patient to the secure portal and its Results/Records section; confirm they selected the correct date and account. Results may need clinician review and should not be interpreted by support staff or this assistant. If a result is missing after the clinic's stated window, route a secure request to the records/lab team.

If the portal route fails, try the official phone/clinic route. Never ask for full medical records or identity documents in ordinary chat. Urgent symptoms or a private chart lookup require a human clinical team; an emergency requires local emergency services, not a ticket queue.

Source: CDC emergency warning signs https://www.cdc.gov/covid/signs-symptoms/index.html`],
    ['Urgent symptoms, privacy and safe service escalation', `For ${'{company}'}, take urgent health concerns seriously and do not keep a person in a troubleshooting loop. This assistant cannot diagnose, assess severity reliably, interpret test results, or make treatment decisions.

If someone reports severe trouble breathing, chest pressure, loss of consciousness, severe bleeding, new confusion, signs of stroke, or another immediate threat, tell them to call their local emergency number or go to the nearest emergency department now. Do not wait for an agent reply. Encourage them not to drive themselves if they may lose consciousness or cannot breathe safely. Emergency numbers vary by location, so use the customer's local service.

For non-emergency symptom questions, ask only what is needed to direct them to the clinician/appointment route; do not prescribe or diagnose. If the patient says symptoms are worsening, asks whether to stop/start a medicine, or needs an individual test/result reviewed, route to a qualified clinician. For possible medication overdose or poisoning, contact local poison control/emergency services promptly.

Protect privacy: use the authenticated portal for records and ask for the minimum identifier needed there. Never request a password, one-time code, payment security code or full medical document in the help desk. A human must handle identity verification, clinical advice, record corrections and disclosure to another person.

Source: CDC guidance on emergency warning signs https://www.cdc.gov/covid/signs-symptoms/index.html`],
  ],
  finance: [
    ['Fraud, lost access and suspicious transactions', `Use this urgent checklist for ${'{company}'} account-security reports. If the customer sees an unfamiliar debit, card charge, transfer or believes a credential was stolen, tell them to contact the financial institution immediately using the official app, the number on the card, or a trusted website they type themselves. Do not use a phone number or link supplied in a suspicious message.

If a card may be lost or compromised, use the official app's lock/freeze function if available, then contact the issuer to report it and request next steps. If an account password was exposed, change it through the official site from a trusted device, secure the recovery email, and sign out other sessions if that option is available. If money was sent to a scammer, contact the bank/payment provider immediately; speed can matter. Keep transaction date, amount and reference, but never send a PIN, password, one-time code, full card number or seed phrase to support.

Do not promise reimbursement, liability outcomes, reversal or a timeframe. Those depend on account facts, payment type, provider rules and local law. A staff member must review the private transaction and file a formal dispute. The assistant should give immediate containment steps, then route the case for secure verification.

If the first lock/contact route is unavailable, use the provider's alternate official phone number or branch/contact channel. For a suspected scam, stop communicating with the sender and report through trusted official channels.

Sources: CFPB unauthorized transaction guidance https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-my-money-back-after-i-discover-an-unauthorized-transaction-or-money-missing-from-my-bank-account-en-1017/ ; CFPB phishing warning https://www.consumerfinance.gov/ask-cfpb/i-received-an-email-from-my-bank-or-credit-union-asking-me-to-verify-my-account-information-what-should-i-do-en-999/`],
    ['Transfers, card payments and account-service checks', `For ${'{company}'} payment questions, first determine whether the transaction is pending, declined, completed or absent. Have the customer check the transaction in their own official account and note the date, amount, currency, recipient and reference. Never ask for a PIN, password, one-time code, full card/account number or private key.

Transfer delayed: confirm the destination details and status shown in the app. Check the published processing calendar, cut-off times, weekends/holidays and any displayed hold. Do not tell the customer to send a second transfer while the first is pending. If the published processing window passed, route the transfer reference securely to operations for tracing.

Card declined: check that the card is active/unlocked, expiry and billing details are current, the merchant accepts that card type, and the customer's own account shows available funds/limits. Try one small non-sensitive checkout only if no pending charge exists. Repeated declines, a risk block or suspected skimming require the issuer's secure review.

Duplicate or unknown charge: compare posted transactions, not just authorisations; note merchant/date/amount, lock a compromised card if possible, and contact the issuer promptly. A human must review the ledger and open a dispute. Never guarantee a reversal or refund.

If self-service status and the published processing window do not resolve it, hand over the secure reference with steps tried. The customer should use trusted official channels for urgent fraud reports.

Source: CFPB steps for unauthorized payments https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-my-money-back-after-i-discover-an-unauthorized-transaction-or-money-missing-from-my-bank-account-en-1017/`],
  ],
  food: [
    ['Allergens, ingredients and food-safety questions', `Treat allergy questions for ${'{company}'} as safety-critical. Never guess whether a dish is safe from its name or a general ingredient list. Recipes, suppliers and kitchen practices can change, and cross-contact may occur.

Ask the customer to name the allergen and exact menu item, then check the current official ingredient/allergen information. If it is not explicit, say you cannot confirm safety and ask the kitchen/manager to verify ingredients and cross-contact controls before the customer orders. Do not promise that removing a topping makes a meal safe. If the kitchen cannot verify, advise the customer to choose a different item only after confirming it with staff.

If someone is having a severe reaction, trouble breathing, swelling of the tongue/throat, faintness or collapse, direct them to call local emergency services immediately. If they have a prescribed emergency medicine, they should follow their clinician's instructions. Do not delay emergency help while contacting a restaurant agent.

For a complaint about a suspected food-safety incident, stop eating the item, keep the receipt/packaging if available, note the meal and time, and contact the business. Do not speculate about cause or promise compensation; a manager must investigate. Handle medical details privately and minimally.

Source: FDA food-allergy responsibilities for food service https://www.fda.gov/media/87140/download`],
    ['Late, missing or incorrect orders and reservations', `For ${'{company}'} order problems, distinguish delivery-app tracking from restaurant preparation and from a booking record.

Late/missing delivery: check the order status in the original app or confirmation, verify the delivery address and contact preference, then check a safe drop location or building desk. If the app says delivered but it is missing, do not follow unsolicited payment links; contact the merchant/platform using its official app. A staff member must inspect the order and courier record before promising a remake or refund.

Wrong/missing item: keep the packaging and receipt, list only the affected items, and take a photo if useful. Report promptly through the official order channel so the kitchen/platform can compare the ticket. Do not ask a customer to consume an item they believe is unsafe or allergenic.

Reservation: check the confirmation date, local time, party size, location and booking name. For a change, cancellation, accessibility need or seating request, use the official booking route. Do not tell the customer a table is guaranteed unless the reservation system confirms it. If arrival is imminent and the booking cannot be found, pass to the host/manager with the reference.

If the app route fails, offer the restaurant's published phone or in-person contact option. If the order/refund/table status needs a private lookup, hand over the reference securely and summarize the steps already attempted.

Sources: FTC online purchase guidance https://consumer.ftc.gov/consumer-alerts/2023/04/shopping-online-heres-what-do-when-things-go-wrong ; FDA allergen food-service guidance https://www.fda.gov/media/87140/download`],
  ],
  travel: [
    ['Flight disruption, missed connections and rebooking', `For a ${'{company}'} itinerary issue, first distinguish a live disruption from a general fare-rule question. If the customer is at the airport or departure is imminent, direct them to the airline's official app, airport desk or published urgent contact channel now; a support ticket may not be fast enough.

Check the official flight status and the booking's latest notification. Record flight number, travel date, route and booking reference only through the secure ticket. Do not promise a rebooking, hotel, meal, refund or compensation until the carrier and applicable rules are verified. Options differ by carrier, route, cause and jurisdiction.

For a missed connection, ask whether both flights are on one ticket and whether the first flight caused the miss; this affects which carrier can help. Keep boarding passes and receipts for reasonable necessary expenses. If the customer bought separate tickets, advise them to contact each carrier directly because one may not protect the other booking.

If the self-service rebooking route fails, approach the operating carrier's airport desk or official phone/app channel. For a future departure, offer the carrier's published contact path and hand off when a booking-specific change or payment review is needed.

Source: U.S. Department of Transportation passenger guidance https://www.transportation.gov/airconsumer/fly-rights`],
    ['Delayed baggage, trip changes and document checks', `For ${'{company}'} travel help, start with current itinerary-specific instructions; passport, visa, entry, rail and airline rules depend on destination, carrier and travel date. Do not guess or promise entry eligibility. Direct the customer to the official government/transport provider for current requirements.

Delayed checked bag: report it to the operating airline's baggage desk before leaving the airport when possible, obtain a mishandled-baggage report/reference, and keep the baggage tag, itinerary and receipts for necessary purchases. Use the airline's baggage tracker and keep contact details current. If the bag is damaged, photograph it and file promptly using the carrier's official claims channel. A staff member must review the itinerary and policy before giving reimbursement promises.

Change or cancellation: open the booking through the provider's official site/app and review the fare conditions, deadline, passenger name and any connecting segments. Do not cancel before checking whether a change is possible; separate tickets may be treated independently. If a ticket was booked through an agency, contact the merchant shown on the receipt as well as the carrier.

If self-service fails, use the operating carrier/agency's official phone or airport desk. Route account-specific itinerary changes, refund calculations or baggage claims to a human with the booking reference and steps tried.

Source: U.S. DOT lost, delayed or damaged baggage https://www.transportation.gov/lost-delayed-or-damaged-baggage`],
  ],
  legal: [
    ['Preparing for a legal or professional-service consultation', `This guide is for administrative support at ${'{company}'}; it is not legal, tax or professional advice. Do not interpret a person's rights, calculate filing deadlines, predict an outcome or tell them what to submit unless an authorised professional has published that exact instruction for their matter.

For a first consultation, help the prospective client identify the broad service area, relevant location/jurisdiction, any deadline printed on a notice, preferred contact method and accessibility/language needs. Suggest that they gather relevant notices, contracts, correspondence and a short timeline for the professional, but do not ask them to upload sensitive documents in an ordinary ticket. The professional can tell them which documents are needed and how to send them securely.

Explain only the firm's published consultation process, fee structure, conflict-check requirements and contact hours. Never promise that the firm can take a matter, that a filing is timely, that a result is likely, or that an attorney-client relationship exists before the firm's formal confirmation. If there is a court/agency deadline, tell the person to contact a qualified professional promptly and not wait for a general support reply.

If the question depends on facts, jurisdiction or document review, gather only a safe summary and route it to an authorised professional. For billing, provide the public invoice/payment route; staff must inspect the account for individual balances or write-offs.

Source: American Bar Association, questions to ask a lawyer https://www.americanbar.org/groups/public_education/resources/law_issues_for_consumers/everyday-law/legal-help/questions_to_ask_a_lawyer/`],
    ['Matter status, documents, deadlines and confidentiality', `For ${'{company}'} existing-client support, separate process guidance from legal/professional judgment. Verify identity through the firm's approved secure process before discussing any matter-specific status. Do not ask a client to post identity documents, privileged communications, full case files, tax identifiers or signatures in the general support form.

Document upload/signature issue: use the secure portal, confirm the file is a supported format and within the stated size limit, try a current browser, and save a local copy before retrying. Do not email sensitive documents unless the firm specifically directs the client to its approved encrypted channel. Ask for the portal error and approximate time, not the document contents.

Matter status: the assistant cannot determine whether a filing was received, whether a deadline was met, or what action a professional has taken. Ask the client to check the official portal/receipt if available, then route a verified request to the assigned professional or case team. If a notice contains a deadline, advise them to contact the team promptly and share the notice only through the secure client channel.

Billing: point to the published invoice help and payment methods. A human must review a specific invoice, trust balance, tax position, refund or fee dispute. Summarize the issue and reference without exposing sensitive content.

If the portal route fails, offer the firm's official phone number or secure email route. When a private file lookup or professional judgment is needed, hand it to the assigned person without trying to resolve the substance in public chat.

Sources: ABA initial-consultation guidance https://www.americanbar.org/groups/public_education/resources/law_issues_for_consumers/everyday-law/legal-help/questions_to_ask_a_lawyer/ ; ABA civil legal-aid client guidance https://www.americanbar.org/groups/legal_aid_indigent_defense/resource_center_for_access_to_justice/standards-and-policy/updated-standards-for-the-provision-of-civil-legal-aid/appendix/guideline-b-2-on-initial-exploration-of-the-client-s-legal-probl/`],
  ],
};

function forCompany(company) {
  const docs = (PLAYBOOKS[company.niche] || PLAYBOOKS.general).map(([title, body]) => [
    `${company.name} | ${title}`,
    body.replaceAll('{company}', company.name),
  ]);
  docs.push([
    `${company.name} | WhatsApp on a new phone and QR chat transfer`,
    `If someone contacting ${company.name} asks why WhatsApp on a new phone is asking them to transfer with a QR code, explain that this is WhatsApp's normal direct chat-transfer flow when the old phone is available. It is meant to move chat history and media; the QR code is shown on the new phone and scanned from WhatsApp on the old phone.

Guide them through this sequence: (1) Keep WhatsApp and the chat history on the old phone. Do not erase, reset or uninstall WhatsApp from it. (2) Make sure they can verify the same WhatsApp phone number on the new phone. Keep both phones nearby, powered and with Wi-Fi enabled; update WhatsApp from the official app store if either app is old. (3) On the new phone, continue setup and choose the offered transfer-from-old-phone option to show its QR code. (4) On the old phone, open WhatsApp > Settings (or More options) > Chats > Transfer chats > Start, grant the requested permissions, and use WhatsApp on the old phone to scan the QR code on the new phone. (5) Keep both phones unlocked and WhatsApp open until it says the transfer is complete, then check that the chats you need are present before retiring the old phone.

If the old phone is unavailable, the QR route cannot be completed from that device; use WhatsApp's official backup/restore or platform-switch instructions for the phone pair instead. If the QR screen is missing, confirm the new phone is still at the transfer step, both devices have Wi-Fi enabled, and requested permissions are allowed; restart both phones and try again. Do not use unofficial transfer apps, and do not share a registration or verification code with anyone. If the user has already created important new chats on the new phone, warn that histories may not merge; check the current WhatsApp instructions before reinstalling anything.

Ask one follow-up only if needed: do they still have the old phone, and are the phones both Android, both iPhone, or one of each? Never ask for their WhatsApp verification code or ask them to post private chat contents.

Source: WhatsApp Help Center, transfer chat history https://faq.whatsapp.com/209942271778103/ ; can't transfer chat history https://faq.whatsapp.com/1039228717453239/ ; changing phones https://faq.whatsapp.com/1197347060992858/`,
  ]);
  return docs;
}

module.exports = { forCompany };
