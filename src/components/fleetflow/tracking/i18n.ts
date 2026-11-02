// ─────────────────────────────────────────────────────────────
// Public tracking page copy — English + Bangla (bn).
// Pure module (no React, no "use client"): the server page uses it for
// metadata and the initial language, the client components for all text.
// Every key MUST exist in both languages (enforced by the type below and
// by tests/unit/tracking-i18n.test.ts).
// ─────────────────────────────────────────────────────────────

export type Lang = "en" | "bn";
export const LANGS: readonly Lang[] = ["en", "bn"];

/** localStorage key for the visitor's choice. */
export const LANG_STORAGE_KEY = "ff-track-lang";
/** Cookie mirror of the choice so the server renders the right language with no flash. */
export const LANG_COOKIE = "ff_track_lang";

/** Intl locale per language — bn-BD gives Bengali digits and month names. */
export const INTL_LOCALE: Record<Lang, string> = { en: "en-GB", bn: "bn-BD" };

type StatusMap = Record<"CREATED" | "ASSIGNED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "FAILED" | "CANCELLED", string>;

const en = {
  // Meta / page chrome
  metaTitle: (code: string, company: string) => `Track ${code} · ${company}`,
  metaTitleGeneric: "Delivery tracking",
  headerDeliveryFrom: "Delivery from",
  headerTracking: "Delivery tracking",
  footerPoweredBy: "Tracking powered by FleetFlow",
  languageToggleLabel: "Language",
  checking: "Checking your delivery…",
  whatYouCanDo: "What you can do",

  // Link problems / errors
  invalidTitle: "Tracking link not recognized",
  invalidBody: "Check the link you received and try again, or contact the sender.",
  invalidStep1: "Open the full link from the SMS or message you received — part of it may be missing.",
  invalidStep2: "Still not working? Contact the sender and ask them to resend your tracking link.",
  revokedTitle: "This tracking link has been revoked",
  revokedBody: "The sender disabled tracking for this delivery. Contact them for an update.",
  revokedBodyNamed: (name: string) => `${name} disabled tracking for this delivery. Contact them for an update.`,
  revokedStep1: "Contact the sender for an update on your delivery.",
  revokedStep1Named: (name: string) => `Contact ${name} for an update on your delivery.`,
  revokedStep2: "Ask them for a new tracking link if you'd like to keep following it here.",
  errorTitle: "Something went wrong",
  errorBody: "We couldn't load your delivery right now. Please try again.",
  errorStep1: "Check your internet connection, then try again.",
  errorStep2: "If the problem continues, try again in a few minutes.",
  tryAgain: "Try again",
  callSender: (name: string) => `Call ${name}`,

  // Statuses
  trackingBadge: "Tracking",
  statusHeadline: {
    CREATED: "Order received",
    ASSIGNED: "Courier assigned",
    PICKED_UP: "Picked up",
    IN_TRANSIT: "On the way",
    DELIVERED: "Delivered",
    FAILED: "Attempt unsuccessful",
    CANCELLED: "Cancelled",
  } satisfies StatusMap,
  statusHeadlineDefault: "Tracking your delivery",
  eventLabels: {
    CREATED: "Order received",
    ASSIGNED: "Courier assigned",
    PICKED_UP: "Picked up",
    IN_TRANSIT: "On the way",
    DELIVERED: "Delivered",
    FAILED: "Attempt unsuccessful",
    CANCELLED: "Cancelled",
    NOTE: "Update",
    TRACKING_UPDATED: "Update",
    OVERRIDE: "Status updated",
    RESCHEDULE_REQUESTED: "You asked to reschedule",
    RESCHEDULE_ACCEPTED: "New delivery day confirmed",
    RESCHEDULE_DECLINED: "Reschedule request declined",
  } as Record<string, string>,
  explainCreated: (sender: string) => `${sender} has received your order and is preparing it for delivery.`,
  explainAssigned: "A courier has been assigned and will collect your parcel soon.",
  explainPickedUp: "Your parcel has been collected and will be on its way shortly.",
  explainInTransit: "Your parcel left the warehouse and is with the courier.",
  explainDelivered: "Your parcel has been handed over. Thank you for your order.",
  explainFailed: (reason: string | null, sender: string) =>
    `${reason ? `${reason}. ` : "We couldn’t complete the delivery. "}${sender} will contact you to arrange a new time.`,
  explainCancelled: "This delivery has been cancelled and will not be delivered. Contact the sender if you have any questions.",
  explainDefault: "We'll keep this page up to date as your delivery progresses.",
  failureReasons: {
    RECIPIENT_UNAVAILABLE: "Recipient not available",
    WRONG_ADDRESS: "Address not found or incorrect",
    RECIPIENT_REFUSED: "Recipient refused delivery",
    PACKAGE_DAMAGED: "Package damaged",
    VEHICLE_ISSUE: "Vehicle breakdown",
  } as Record<string, string>,

  // Times
  today: "today",
  tomorrow: "tomorrow",
  yesterday: "yesterday",
  deliveredAt: (time: string, date: string) => `Delivered at ${time}, ${date}`,
  etaToBeConfirmed: "Delivery time to be confirmed",
  expectedDay: (day: string) => `Expected ${day}`,
  expectedDayBy: (day: string, time: string) => `Expected ${day} by ${time}`,
  justNow: "Just now",
  minAgo: (n: string) => `${n} min ago`,
  todayAt: (time: string) => `Today, ${time}`,
  yesterdayAt: (time: string) => `Yesterday, ${time}`,
  dateAt: (date: string, time: string) => `${date}, ${time}`,
  updatedJustNow: "Updated just now",
  updatedMinAgo: (n: string) => `Updated ${n} min ago`,
  updatedHrAgo: (n: string) => `Updated ${n} hr ago`,

  // Live row
  live: (updated: string) => `Live · ${updated}`,
  refreshFailed: "Couldn't refresh — showing the last update",
  refreshAria: "Refresh delivery status",
  refresh: "Refresh",
  refreshing: "Refreshing…",

  // Progress
  progressHeading: "Delivery progress",
  progressCount: (reached: string, total: string) => `${reached} of ${total}`,
  cancelledShort: "Cancelled",
  attemptUnsuccessful: "Attempt unsuccessful",
  srStepFailed: "attempt unsuccessful",
  srStepCurrent: "current step",
  srStepDone: "completed",
  srStepPending: "not yet",

  // Cash on delivery
  codDueTitle: "Amount to pay on delivery",
  codDueHint: "Please have this amount ready when your parcel arrives.",
  codPaid: "Paid on delivery",
  payment: "Payment",

  // Details
  detailsHeading: "Delivery details",
  recipient: "Recipient",
  deliveryAddress: "Delivery address",
  openInMaps: "Open in Maps",
  opensNewTab: "(opens in a new tab)",
  orderPlaced: "Order placed",
  questionsTitle: "Questions about this delivery?",
  questionsBody: (name: string) => `${name} can help with timing or anything else about your parcel.`,

  // Timeline
  updatesHeading: "Delivery updates",
  updatesCount: (n: number, formatted: string) => `${formatted} ${n === 1 ? "update" : "updates"}`,
  noUpdates: "No updates yet.",
  showFewer: "Show fewer updates",
  showAll: (formatted: string) => `Show all ${formatted} updates`,

  // Branding
  messageFrom: (name: string) => `A note from ${name}`,
  logoAlt: (name: string) => `${name} logo`,

  // Rating (after delivery)
  rateTitle: "How was your delivery?",
  rateBody: (sender: string) => `Your rating helps ${sender} get better. It only takes a moment.`,
  rateStarsLabel: "Your rating",
  rateStar: (n: string) => `${n} out of 5 stars`,
  rateCommentLabel: "Anything to add? (optional)",
  rateCommentPlaceholder: "What went well, or what could be better?",
  rateChooseStars: "Choose from 1 to 5 stars first.",
  rateSubmit: "Send rating",
  rateThanksTitle: "Thank you for your feedback",
  rateYouGave: (n: string) => `You rated this delivery ${n} out of 5.`,
  rateClosesOn: (date: string) => `You can rate until ${date}.`,
  charsLeft: (n: string) => `${n} characters left`,
  sending: "Sending…",

  // Reschedule
  rescheduleTitle: "Can't receive it?",
  rescheduleBody: (sender: string) => `Choose a day that suits you and ${sender} will confirm it.`,
  rescheduleOpen: "Choose another day",
  rescheduleDayLabel: "Day",
  rescheduleWindowLabel: "Time",
  rescheduleWindows: { ANY: "Any time", MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as Record<string, string>,
  rescheduleWindowHints: { ANY: "Whole day", MORNING: "9 am – 12 pm", AFTERNOON: "12 – 5 pm", EVENING: "5 – 9 pm" } as Record<string, string>,
  rescheduleNoteLabel: "Note for the sender (optional)",
  rescheduleNotePlaceholder: "e.g. Please call before coming — the gate is locked after 6 pm",
  rescheduleChooseDay: "Choose a day first.",
  rescheduleSubmit: "Send request",
  rescheduleCancel: "Cancel",
  rescheduleWhen: (day: string, window: string) => `${day}, ${window}`,
  reschedulePendingTitle: "Reschedule requested",
  reschedulePendingBody: (when: string, sender: string) => `You asked for ${when}. ${sender} will confirm soon.`,
  rescheduleAcceptedBody: (sender: string) => `${sender} accepted your request — the expected delivery time is updated.`,
  rescheduleDeclinedBody: (sender: string) => `${sender} couldn't make that day. You can choose another day or call them.`,
  rescheduleLimitBody: (sender: string) => `To change the delivery day again, please contact ${sender}.`,

  // Errors from the feedback forms (by API error code)
  feedbackErrors: {
    rate_limited: "Too many attempts. Please wait a few minutes and try again.",
    already_rated: "This delivery has already been rated.",
    expired: "Ratings for this delivery are closed.",
    not_delivered: "You can rate the delivery once it has arrived.",
    disabled: "The sender has turned this off.",
    not_eligible: "This delivery can no longer be rescheduled.",
    pending: "Your earlier request is still waiting for an answer.",
    limit: "This delivery can't be rescheduled again online. Please contact the sender.",
    invalid_date: "Choose a day from tomorrow up to two weeks ahead.",
    invalid: "Please check what you entered and try again.",
    revoked: "This tracking link has been revoked.",
    not_found: "We couldn't find this delivery.",
    error: "Something went wrong. Please try again.",
  } as Record<string, string>,
  feedbackOffline: "Couldn't send — check your connection and try again.",

  // Live courier position (src/components/fleetflow/tracking/tracking-live-map.tsx)
  liveTitle: "Your courier is on the way",
  liveEta: (minutes: number) => `Arriving in about ${minutes} min`,
  liveEtaUnknown: "Arrival time not available yet",
  liveUpdated: (ago: string) => `Location updated ${ago}`,
  liveJustNow: "just now",
  liveMinutesAgo: (n: number) => `${n} min ago`,
  liveMapLabel: "Map showing the courier and your delivery address",
  liveCourier: "Courier",
  liveDestination: "Delivery address",
  liveNote: "The courier's position is approximate and estimates can change with traffic.",
};

export type TrackingDict = typeof en;

const bn: TrackingDict = {
  metaTitle: (code, company) => `${code} ট্র্যাকিং · ${company}`,
  metaTitleGeneric: "ডেলিভারি ট্র্যাকিং",
  headerDeliveryFrom: "প্রেরক",
  headerTracking: "ডেলিভারি ট্র্যাকিং",
  footerPoweredBy: "ট্র্যাকিং সেবা দিচ্ছে FleetFlow",
  languageToggleLabel: "ভাষা",
  checking: "আপনার ডেলিভারির তথ্য দেখা হচ্ছে…",
  whatYouCanDo: "আপনি যা করতে পারেন",

  invalidTitle: "ট্র্যাকিং লিংকটি চেনা যায়নি",
  invalidBody: "আপনার পাওয়া লিংকটি যাচাই করে আবার চেষ্টা করুন, অথবা প্রেরকের সাথে যোগাযোগ করুন।",
  invalidStep1: "আপনার পাওয়া এসএমএস বা মেসেজ থেকে পুরো লিংকটি খুলুন — লিংকের কিছু অংশ বাদ পড়ে থাকতে পারে।",
  invalidStep2: "তবুও কাজ না করলে প্রেরকের সাথে যোগাযোগ করে ট্র্যাকিং লিংকটি আবার পাঠাতে বলুন।",
  revokedTitle: "এই ট্র্যাকিং লিংকটি বাতিল করা হয়েছে",
  revokedBody: "প্রেরক এই ডেলিভারির ট্র্যাকিং বন্ধ করে দিয়েছেন। হালনাগাদ তথ্যের জন্য তাঁদের সাথে যোগাযোগ করুন।",
  revokedBodyNamed: (name) => `${name} এই ডেলিভারির ট্র্যাকিং বন্ধ করে দিয়েছেন। হালনাগাদ তথ্যের জন্য তাঁদের সাথে যোগাযোগ করুন।`,
  revokedStep1: "আপনার ডেলিভারির হালনাগাদ তথ্যের জন্য প্রেরকের সাথে যোগাযোগ করুন।",
  revokedStep1Named: (name) => `আপনার ডেলিভারির হালনাগাদ তথ্যের জন্য ${name}-এর সাথে যোগাযোগ করুন।`,
  revokedStep2: "এখানে ডেলিভারির খবর জানতে চাইলে তাঁদের কাছে নতুন একটি ট্র্যাকিং লিংক চেয়ে নিন।",
  errorTitle: "একটি সমস্যা হয়েছে",
  errorBody: "এই মুহূর্তে আপনার ডেলিভারির তথ্য দেখানো যাচ্ছে না। অনুগ্রহ করে আবার চেষ্টা করুন।",
  errorStep1: "আপনার ইন্টারনেট সংযোগ ঠিক আছে কি না দেখে আবার চেষ্টা করুন।",
  errorStep2: "সমস্যাটি থেকে গেলে কয়েক মিনিট পর আবার চেষ্টা করুন।",
  tryAgain: "আবার চেষ্টা করুন",
  callSender: (name) => `${name}-কে কল করুন`,

  trackingBadge: "ট্র্যাকিং",
  statusHeadline: {
    CREATED: "অর্ডার গ্রহণ করা হয়েছে",
    ASSIGNED: "কুরিয়ার নির্ধারণ করা হয়েছে",
    PICKED_UP: "পার্সেল সংগ্রহ করা হয়েছে",
    IN_TRANSIT: "পথে আছে",
    DELIVERED: "ডেলিভারি সম্পন্ন হয়েছে",
    FAILED: "ডেলিভারির চেষ্টা সফল হয়নি",
    CANCELLED: "বাতিল করা হয়েছে",
  },
  statusHeadlineDefault: "আপনার ডেলিভারি ট্র্যাক করা হচ্ছে",
  eventLabels: {
    CREATED: "অর্ডার গ্রহণ করা হয়েছে",
    ASSIGNED: "কুরিয়ার নির্ধারণ করা হয়েছে",
    PICKED_UP: "পার্সেল সংগ্রহ করা হয়েছে",
    IN_TRANSIT: "পথে আছে",
    DELIVERED: "ডেলিভারি সম্পন্ন হয়েছে",
    FAILED: "ডেলিভারির চেষ্টা সফল হয়নি",
    CANCELLED: "বাতিল করা হয়েছে",
    NOTE: "হালনাগাদ",
    TRACKING_UPDATED: "হালনাগাদ",
    OVERRIDE: "অবস্থা হালনাগাদ করা হয়েছে",
    RESCHEDULE_REQUESTED: "আপনি ডেলিভারির দিন বদলাতে অনুরোধ করেছেন",
    RESCHEDULE_ACCEPTED: "নতুন ডেলিভারির দিন নিশ্চিত করা হয়েছে",
    RESCHEDULE_DECLINED: "দিন বদলের অনুরোধটি গ্রহণ করা হয়নি",
  },
  explainCreated: (sender) => `${sender} আপনার অর্ডারটি পেয়েছে এবং ডেলিভারির জন্য প্রস্তুত করছে।`,
  explainAssigned: "একজন কুরিয়ার নির্ধারণ করা হয়েছে, তিনি শিগগিরই আপনার পার্সেলটি সংগ্রহ করবেন।",
  explainPickedUp: "আপনার পার্সেলটি সংগ্রহ করা হয়েছে এবং শিগগিরই আপনার উদ্দেশে রওনা হবে।",
  explainInTransit: "আপনার পার্সেলটি গুদাম থেকে বের হয়ে কুরিয়ারের সাথে আপনার কাছে আসছে।",
  explainDelivered: "আপনার পার্সেলটি বুঝিয়ে দেওয়া হয়েছে। অর্ডার করার জন্য ধন্যবাদ।",
  explainFailed: (reason, sender) =>
    `${reason ? `${reason}। ` : "ডেলিভারিটি সম্পন্ন করা যায়নি। "}নতুন সময় ঠিক করতে ${sender} আপনার সাথে যোগাযোগ করবে।`,
  explainCancelled: "এই ডেলিভারিটি বাতিল করা হয়েছে, পার্সেলটি আর পৌঁছে দেওয়া হবে না। কোনো প্রশ্ন থাকলে প্রেরকের সাথে যোগাযোগ করুন।",
  explainDefault: "ডেলিভারি যত এগোবে, এই পেজে তত হালনাগাদ তথ্য দেখানো হবে।",
  failureReasons: {
    RECIPIENT_UNAVAILABLE: "প্রাপককে পাওয়া যায়নি",
    WRONG_ADDRESS: "ঠিকানাটি খুঁজে পাওয়া যায়নি বা সঠিক নয়",
    RECIPIENT_REFUSED: "প্রাপক পার্সেলটি গ্রহণ করেননি",
    PACKAGE_DAMAGED: "পার্সেলটি ক্ষতিগ্রস্ত হয়েছে",
    VEHICLE_ISSUE: "গাড়িতে যান্ত্রিক সমস্যা হয়েছে",
  },

  today: "আজ",
  tomorrow: "আগামীকাল",
  yesterday: "গতকাল",
  deliveredAt: (time, date) => `ডেলিভারি হয়েছে ${date}, ${time}`,
  etaToBeConfirmed: "ডেলিভারির সময় পরে জানানো হবে",
  expectedDay: (day) => `সম্ভাব্য ডেলিভারি ${day}`,
  expectedDayBy: (day, time) => `সম্ভাব্য ডেলিভারি ${day} ${time}-এর মধ্যে`,
  justNow: "এইমাত্র",
  minAgo: (n) => `${n} মিনিট আগে`,
  todayAt: (time) => `আজ, ${time}`,
  yesterdayAt: (time) => `গতকাল, ${time}`,
  dateAt: (date, time) => `${date}, ${time}`,
  updatedJustNow: "এইমাত্র হালনাগাদ হয়েছে",
  updatedMinAgo: (n) => `${n} মিনিট আগে হালনাগাদ হয়েছে`,
  updatedHrAgo: (n) => `${n} ঘণ্টা আগে হালনাগাদ হয়েছে`,

  live: (updated) => `লাইভ · ${updated}`,
  refreshFailed: "হালনাগাদ করা যায়নি — সর্বশেষ তথ্য দেখানো হচ্ছে",
  refreshAria: "ডেলিভারির অবস্থা রিফ্রেশ করুন",
  refresh: "রিফ্রেশ",
  refreshing: "রিফ্রেশ হচ্ছে…",

  progressHeading: "ডেলিভারির অগ্রগতি",
  progressCount: (reached, total) => `${total}টির মধ্যে ${reached}টি`,
  cancelledShort: "বাতিল",
  attemptUnsuccessful: "চেষ্টা সফল হয়নি",
  srStepFailed: "চেষ্টা সফল হয়নি",
  srStepCurrent: "বর্তমান ধাপ",
  srStepDone: "সম্পন্ন",
  srStepPending: "এখনো হয়নি",

  codDueTitle: "ডেলিভারির সময় পরিশোধ করুন",
  codDueHint: "পার্সেল পৌঁছানোর সময় অনুগ্রহ করে এই পরিমাণ টাকা প্রস্তুত রাখুন।",
  codPaid: "ডেলিভারির সময় পরিশোধ করা হয়েছে",
  payment: "পেমেন্ট",

  detailsHeading: "ডেলিভারির বিবরণ",
  recipient: "প্রাপক",
  deliveryAddress: "ডেলিভারির ঠিকানা",
  openInMaps: "ম্যাপে দেখুন",
  opensNewTab: "(নতুন ট্যাবে খুলবে)",
  orderPlaced: "অর্ডারের তারিখ",
  questionsTitle: "এই ডেলিভারি নিয়ে কোনো প্রশ্ন আছে?",
  questionsBody: (name) => `ডেলিভারির সময় বা আপনার পার্সেল নিয়ে যেকোনো বিষয়ে ${name} আপনাকে সাহায্য করতে পারবে।`,

  updatesHeading: "ডেলিভারির হালনাগাদ",
  updatesCount: (_n, formatted) => `${formatted}টি হালনাগাদ`,
  noUpdates: "এখনো কোনো হালনাগাদ নেই।",
  showFewer: "কম দেখান",
  showAll: (formatted) => `সবগুলো (${formatted}টি) হালনাগাদ দেখুন`,

  messageFrom: (name) => `${name}-এর বার্তা`,
  logoAlt: (name) => `${name}-এর লোগো`,

  rateTitle: "ডেলিভারি কেমন ছিল?",
  rateBody: (sender) => `আপনার রেটিং ${sender}-কে আরও ভালো সেবা দিতে সাহায্য করবে। মাত্র কয়েক সেকেন্ড লাগবে।`,
  rateStarsLabel: "আপনার রেটিং",
  rateStar: (n) => `৫-এর মধ্যে ${n} তারকা`,
  rateCommentLabel: "আর কিছু বলতে চান? (ঐচ্ছিক)",
  rateCommentPlaceholder: "কী ভালো লেগেছে, বা কী আরও ভালো হতে পারত?",
  rateChooseStars: "আগে ১ থেকে ৫টি তারকা বেছে নিন।",
  rateSubmit: "রেটিং পাঠান",
  rateThanksTitle: "আপনার মতামতের জন্য ধন্যবাদ",
  rateYouGave: (n) => `আপনি এই ডেলিভারিকে ৫-এর মধ্যে ${n} দিয়েছেন।`,
  rateClosesOn: (date) => `${date} পর্যন্ত রেটিং দেওয়া যাবে।`,
  charsLeft: (n) => `আর ${n}টি অক্ষর লেখা যাবে`,
  sending: "পাঠানো হচ্ছে…",

  rescheduleTitle: "পার্সেলটি নিতে পারবেন না?",
  rescheduleBody: (sender) => `আপনার সুবিধামতো একটি দিন বেছে নিন, ${sender} তা নিশ্চিত করবে।`,
  rescheduleOpen: "অন্য দিন বেছে নিন",
  rescheduleDayLabel: "দিন",
  rescheduleWindowLabel: "সময়",
  rescheduleWindows: { ANY: "যেকোনো সময়", MORNING: "সকাল", AFTERNOON: "দুপুর", EVENING: "সন্ধ্যা" },
  rescheduleWindowHints: { ANY: "সারাদিন", MORNING: "সকাল ৯টা – দুপুর ১২টা", AFTERNOON: "দুপুর ১২টা – বিকাল ৫টা", EVENING: "বিকাল ৫টা – রাত ৯টা" },
  rescheduleNoteLabel: "প্রেরকের জন্য নোট (ঐচ্ছিক)",
  rescheduleNotePlaceholder: "যেমন: আসার আগে ফোন করবেন — সন্ধ্যা ৬টার পর গেট বন্ধ থাকে",
  rescheduleChooseDay: "আগে একটি দিন বেছে নিন।",
  rescheduleSubmit: "অনুরোধ পাঠান",
  rescheduleCancel: "বাতিল",
  rescheduleWhen: (day, window) => `${day}, ${window}`,
  reschedulePendingTitle: "দিন বদলের অনুরোধ পাঠানো হয়েছে",
  reschedulePendingBody: (when, sender) => `আপনি ${when} চেয়েছেন। ${sender} শিগগিরই তা নিশ্চিত করবে।`,
  rescheduleAcceptedBody: (sender) => `${sender} আপনার অনুরোধ গ্রহণ করেছে — সম্ভাব্য ডেলিভারির সময় হালনাগাদ করা হয়েছে।`,
  rescheduleDeclinedBody: (sender) => `${sender} ওই দিনে ডেলিভারি দিতে পারছে না। আপনি অন্য একটি দিন বেছে নিতে পারেন অথবা তাঁদের ফোন করতে পারেন।`,
  rescheduleLimitBody: (sender) => `ডেলিভারির দিন আবার বদলাতে ${sender}-এর সাথে যোগাযোগ করুন।`,

  feedbackErrors: {
    rate_limited: "অনেকবার চেষ্টা করা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।",
    already_rated: "এই ডেলিভারির রেটিং আগেই দেওয়া হয়েছে।",
    expired: "এই ডেলিভারির রেটিং দেওয়ার সময় শেষ হয়ে গেছে।",
    not_delivered: "পার্সেলটি পৌঁছানোর পর রেটিং দিতে পারবেন।",
    disabled: "প্রেরক এই সুবিধাটি বন্ধ রেখেছেন।",
    not_eligible: "এই ডেলিভারির দিন আর বদলানো যাবে না।",
    pending: "আপনার আগের অনুরোধটির উত্তর এখনো আসেনি।",
    limit: "এই ডেলিভারির দিন অনলাইনে আর বদলানো যাবে না। প্রেরকের সাথে যোগাযোগ করুন।",
    invalid_date: "আগামীকাল থেকে দুই সপ্তাহের মধ্যে একটি দিন বেছে নিন।",
    invalid: "আপনার দেওয়া তথ্য যাচাই করে আবার চেষ্টা করুন।",
    revoked: "এই ট্র্যাকিং লিংকটি বাতিল করা হয়েছে।",
    not_found: "ডেলিভারিটি খুঁজে পাওয়া যায়নি।",
    error: "একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  },
  feedbackOffline: "পাঠানো যায়নি — ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",

  liveTitle: "আপনার কুরিয়ার পথে আছেন",
  liveEta: (minutes) => `আনুমানিক ${minutes.toLocaleString("bn-BD")} মিনিটের মধ্যে পৌঁছাবেন`,
  liveEtaUnknown: "পৌঁছানোর সময় এখনো জানা যায়নি",
  liveUpdated: (ago) => `অবস্থান হালনাগাদ হয়েছে ${ago}`,
  liveJustNow: "এইমাত্র",
  liveMinutesAgo: (n) => `${n.toLocaleString("bn-BD")} মিনিট আগে`,
  liveMapLabel: "কুরিয়ার ও আপনার ডেলিভারি ঠিকানা দেখানো মানচিত্র",
  liveCourier: "কুরিয়ার",
  liveDestination: "ডেলিভারি ঠিকানা",
  liveNote: "কুরিয়ারের অবস্থান আনুমানিক, যানজটের কারণে সময় বদলাতে পারে।",
};

export const DICTIONARIES: Record<Lang, TrackingDict> = { en, bn };

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "bn";
}

/** Pick the language from an Accept-Language header: the highest-weighted of bn/en, else English. */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { primary: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.weight > 0 && (x.primary === "bn" || x.primary === "en"))
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  return ranked[0]?.primary === "bn" ? "bn" : "en";
}

/** Initial language: explicit ?lang=, then the saved choice (cookie), then the browser's Accept-Language. */
export function pickLang({ query, saved, acceptLanguage }: { query?: unknown; saved?: unknown; acceptLanguage?: string | null }): Lang {
  if (isLang(query)) return query;
  if (isLang(saved)) return saved;
  return langFromAcceptLanguage(acceptLanguage);
}
