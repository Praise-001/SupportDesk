'use strict';
const { t } = require('./helpers');

module.exports = [
  {
    name: `OpenDoor Community Hub`,
    domain: `opendoorhub.example`,
    owner: `Marguerite Tremblay`,
    bot: `Maya`,
    about: `OpenDoor Community Hub is a non-profit in Toronto that connects neighbours with free services: food bank pick-ups, volunteer shifts, tax-filing clinics, language classes and a tool library. Our vision is that nobody in the community has to work out where to turn on their own. The help desk is staffed by volunteers and paid coordinators, and every message is read by a person within two hours.`,
    agents: [
      [`Tunde Adeyemi`, [`Question`, `Account`]],
      [`Sofia Petrova`, [`Question`, `Feature request`, `Other`]],
      [`Daniel Cho`, [`Billing`, `Bug / Something broken`, `Other`]],
    ],
    faqs: [
      [`When is the food bank open?`, `The food bank is open Tuesday and Thursday from 10:00 to 16:00, and Saturday from 9:00 to 13:00. You do not need an appointment. Bring any ID with your name on it the first time you visit.`],
      [`How do I sign up as a volunteer?`, `Create a volunteer profile on our website, choose the programmes you are interested in and pick a first shift. A coordinator confirms your shift by email within two working days. Volunteers under 18 need a parent or guardian to sign the consent form.`],
      [`Is the tax clinic really free?`, `Yes. The free tax clinic is for people with a household income under 40,000 dollars. It runs from March to April by appointment. Bring your identification, slips and last year's notice of assessment.`],
      [`How do I borrow tools from the tool library?`, `Sign up for a free library card at the hub, then reserve tools online or in person. You can borrow up to three tools for seven days. Late tools are charged 2 dollars a day, which we waive if you tell us beforehand.`],
      [`Do you offer language classes?`, `We run English and French conversation classes four evenings a week, plus a beginners' course on Saturday mornings. Classes are free for residents and new arrivals. Registration opens on the first of each month.`],
      [`Can I get a receipt for my donation?`, `Donations of 20 dollars or more receive an official tax receipt by email within five working days. Please check that your name and address on the donation are correct, because we cannot change a receipt after it is issued.`],
      [`How can I donate food or goods?`, `Drop off non-perishable food, clean clothing and household items at the side door Monday to Saturday between 9:00 and 17:00. We cannot accept opened food, large furniture or electronics. For larger donations, request a pick-up through the website.`],
      [`I need help in a language other than English.`, `Write to us in your own language. Our assistant can reply in many languages, and volunteers who speak Spanish, Tagalog, Arabic, Punjabi and Mandarin are available on request.`],
      [`How do I report a problem with the hub's website?`, `Choose "Bug / Something broken" when you send your request and tell us which page you were on and what you saw. A screenshot helps. Our web volunteers look at these every Monday and Thursday.`],
    ],
    docs: [
      [`Volunteer handbook`, `Welcome to the OpenDoor volunteer team. Every volunteer is asked to arrive ten minutes before their shift and to sign in at the front desk. Wear closed shoes in the food bank and the tool library.\n\nPrivacy comes first. Never share the name or situation of anyone who uses our services, including with friends or on social media. Do not take photographs inside the hub unless a coordinator has asked you to and the people in the photo have agreed.\n\nIf you cannot make a shift, tell your coordinator at least 24 hours before, using the volunteer page or by phone. If you are ill, stay home and let us know as soon as you can. Volunteers who complete 40 hours receive a reference letter on request.\n\nWe do not tolerate harassment or discrimination of any kind. If something makes you uncomfortable, speak to a coordinator or write to the help desk and choose "Other". Reports are handled in confidence.`],
      [`Food bank guidelines`, `Everyone is welcome. We do not ask about income or immigration status. On a first visit we ask for a name, postal code and household size so that we can plan the amount of food.\n\nA household can visit once a week. A standard hamper contains fresh produce, bread, protein, dairy and pantry items. We can prepare halal, vegetarian and gluten-free hampers if you tell us in advance, either at the desk or through the website.\n\nIf you cannot travel to us, a neighbour or friend may collect a hamper for you with a note signed by you. Home delivery is available for people who are housebound and lives within eight kilometres of the hub. Delivery requests are processed within three working days.`],
      [`Donations and refunds policy`, `We are a registered charity. All donations are final and go to our programmes. If you made a donation by mistake, tell us within 14 days and we will refund it in full to the original card. Refunds take five to ten working days to appear.\n\nMonthly donors can pause or cancel at any time from the donor page or by writing to us. Cancellations take effect before the next charge if they are made at least three days in advance.\n\nTax receipts are issued for donations of 20 dollars or more. We never sell or share donor details.`],
    ],
    tickets: [
      t([`Chidi Okoro`, `chidi.okoro@mail.example`], `Question`, `Food bank hours on Saturday`, `Hi, is the food bank open this Saturday and do I need to book first? I have never been before.`, 6, `bot`, `Hello Chidi. Yes, the food bank is open on Saturday from 9:00 to 13:00 and you do not need an appointment. Bring any ID with your name on it the first time you visit. If you would like a halal, vegetarian or gluten-free hamper, tell us at the desk or through the website.`),
      t([`Hannah Lim`, `hannah.lim@mail.example`], `Billing`, `Charged twice for my monthly donation`, `My monthly donation of 25 dollars shows up twice on my card statement this month. Please refund one of them.`, 70, `new`),
      t([`Yusuf Karim`, `yusuf.karim@mail.example`], `Account`, `Volunteer profile will not save my availability`, `Every time I tick Wednesday evenings and press save, the page reloads and the box is empty again.`, 130, `agent`, `Thanks Yusuf, I could reproduce this. It happens when a profile has no phone number. I have added yours for now, so please check Wednesday evenings is saved, and then add a number of your own when you can.`, { after: 18, followup: `It works now, thank you!` }),
      t([`Beatriz Santos`, `beatriz.santos@mail.example`], `Question`, `Pregunta sobre las clases de inglés`, `Hola, quiero inscribirme en las clases de inglés para principiantes. ¿Cuándo abre la inscripción y es gratis?`, 25, `bot`, `Hola Beatriz. Las clases de inglés son gratuitas para residentes y recién llegados. Hay un curso para principiantes los sábados por la mañana, y la inscripción abre el día 1 de cada mes. Si quieres, un miembro del equipo puede ayudarte a registrarte.`),
    ],
  },
  {
    name: `Brightwave Home Services`,
    domain: `brightwavehome.example`,
    owner: `Rashid Al Mansoori`,
    bot: `Ivy`,
    about: `Brightwave Home Services is a home-maintenance marketplace in Dubai and Abu Dhabi. We match households with vetted cleaners, plumbers, electricians, AC technicians and handymen, and we guarantee the work for 30 days. Customers book through the app, pay securely in-app and rate every visit. Our promise is simple: a professional at your door at the time you chose, or your money back.`,
    agents: [
      [`Layla Haddad`, [`Question`, `Account`]],
      [`Omar Farouk`, [`Billing`, `Bug / Something broken`]],
      [`Priyanka Menon`, [`Question`, `Feature request`, `Other`]],
    ],
    faqs: [
      [`How do I book a service?`, `Open the app, choose the service, pick a date and a time slot and confirm. You will see the professional's name, photo and rating before they arrive. You can book up to 30 days ahead.`],
      [`Can I reschedule or cancel a booking?`, `You can reschedule or cancel free of charge up to four hours before the start of your slot. Inside four hours a cancellation fee of 30 AED applies, which is paid to the professional for their travel.`],
      [`What does the 30-day guarantee cover?`, `If the same problem returns within 30 days of a completed job, we send a professional back at no cost. The guarantee covers workmanship, not new faults and not parts that you supplied yourself.`],
      [`How do I pay?`, `You pay in the app by card, Apple Pay or Google Pay after the job is marked complete. We do not accept cash. Your card is only charged when you confirm the job is finished.`],
      [`What if the professional does not arrive?`, `If nobody arrives within 30 minutes of your slot, contact us from the app. We find a replacement or cancel the booking and you pay nothing. You also receive a 25 AED credit.`],
      [`Are your professionals vetted?`, `Yes. Every professional passes an ID and background check, a skills test and a safety briefing before their first job. Their trade licence is checked every year.`],
      [`How are prices set?`, `Cleaning is priced per hour. Repairs are priced per job after the professional has diagnosed the problem, and you approve the quote in the app before any work starts. There are no hidden charges.`],
      [`Do you work on weekends and holidays?`, `Yes, every day from 8:00 to 22:00. A holiday surcharge of 15 percent applies on public holidays and is shown before you confirm.`],
      [`How do I leave a tip or a complaint?`, `After each job the app asks you to rate the visit and add a tip if you wish. For a complaint, choose "Other" in the help desk and give the booking number.`],
    ],
    docs: [
      [`Service guarantee`, `Brightwave guarantees every completed job for 30 days. If the issue you booked us to fix returns within that period, we will send a professional back to put it right at no cost.\n\nThe guarantee does not cover damage caused after the visit, normal wear, or problems that are unrelated to the original job. If you or another contractor change the work after our visit, the guarantee for that part of the job ends.\n\nTo claim, open the booking in the app and choose "Report a problem", or write to the help desk with the booking number and photos if possible. We will propose a revisit within 48 hours. If we cannot fix the issue, you are entitled to a refund of the amount paid for that job.`],
      [`Cancellation and refund policy`, `Free cancellation is available up to four hours before the start of your slot. After that, 30 AED is charged for the professional's travel.\n\nIf a professional cancels or does not arrive, you are never charged. We will offer a replacement for the same day if one is available, and a 25 AED credit.\n\nRefunds for unsatisfactory work are decided after a review of photos and the professional's notes. Approved refunds are returned to the original payment method within five to seven working days. Credits are valid for 90 days.`],
      [`Safety and conduct`, `Professionals wear a Brightwave uniform and carry an ID that matches the profile in your app. Ask to see it before you let anybody in. You never need to give a professional cash, keys or a spare door code.\n\nIf you feel unsafe at any time, ask the professional to leave and contact us immediately from the app. A coordinator will call you within ten minutes. We investigate every report and remove professionals who break our rules.\n\nProfessionals are not allowed to take photographs of your home, to sell products or to ask for payment outside the app.`],
    ],
    tickets: [
      t([`Fatima Zayed`, `fatima.zayed@mail.example`], `Question`, `Can I move my deep clean to tomorrow?`, `I booked a deep clean for today at 5pm but something came up. Can I move it to tomorrow morning?`, 9, `bot`, `Hi Fatima. Yes, you can reschedule free of charge up to four hours before your slot starts. Open the booking in the app and choose a new date and time. If it is already inside four hours, a 30 AED fee applies for the professional's travel.`),
      t([`Mark Dawson`, `mark.dawson@mail.example`], `Bug / Something broken`, `App crashes when I add a photo`, `The app closes every time I try to attach a photo of the leaking pipe. iPhone 14, latest update.`, 88, `new`),
      t([`Aisha Rahman`, `aisha.rahman@mail.example`], `Billing`, `Charged 180 AED but the quote was 120`, `My AC technician quoted 120 AED in the app but my card was charged 180 AED. Booking number BW-48213. This is urgent, I need this fixed today.`, 40, `agent`, `Hi Aisha, I am sorry about this. The extra 60 AED was a spare part that the technician added without your approval, so it should not have been charged. I have started the refund and you will see it within five to seven working days.`, { after: 11 }),
      t([`Vikram Shah`, `vikram.shah@mail.example`], `Account`, `Change my registered phone number`, `I changed my number and cannot receive the login code. How do I update it?`, 150, `resolved`, `Hello Vikram, I have verified your identity by email and updated your phone number. Please log in again and request a new code.`, { after: 22 }),
    ],
  },
];
