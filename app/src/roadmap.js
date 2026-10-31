// The 90-day roadmap every student follows. Keys are stored in the progress table,
// so titles can be reworded without losing anyone's progress. Add new items freely.
const PHASES = [
  {
    key: 'onboarding',
    title: 'Week 0 · Onboarding',
    days: [0, 7],
    items: [
      ['ob_goal', 'Set your 90-day goal with Levi'],
      ['ob_whatnot', 'Whatnot seller account approved'],
      ['ob_tiktok', 'TikTok Shop + Live auction access requested'],
      ['ob_shipping', 'Shipping set up: label printer, scale, mailers, custom shipping profile'],
      ['ob_viewnot', 'ViewNot account connected'],
      ['ob_group', 'Joined the student group chat'],
      ['ob_inventory', 'First inventory order placed'],
      ['ob_course', 'Watched "The full live selling course" start to finish'],
    ],
  },
  {
    key: 'launch',
    title: 'Days 1–30 · Launch',
    days: [1, 30],
    items: [
      ['l_first_show', 'First live show done'],
      ['l_10_shows', '10 shows completed'],
      ['l_schedule', 'Consistent schedule: 4+ shows a week'],
      ['l_1k_show', 'First $1,000 show'],
      ['l_100_followers', '100 followers'],
      ['l_review', 'Sent Levi a show replay for review'],
    ],
  },
  {
    key: 'grow',
    title: 'Days 31–60 · Grow',
    days: [31, 60],
    items: [
      ['g_5k_week', 'First $5,000 week'],
      ['g_repeat', 'Repeat buyers on every show'],
      ['g_giveaways', 'Giveaway + viewers→buyers system running every show'],
      ['g_1k_followers', '1,000 followers'],
      ['g_both', 'Live on both Whatnot and TikTok'],
      ['g_restock', 'Restocking inventory on a schedule'],
    ],
  },
  {
    key: 'scale',
    title: 'Days 61–90 · Scale',
    days: [61, 90],
    items: [
      ['s_10k_week', 'First $10,000 week'],
      ['s_30k_month', 'First $30,000 month'],
      ['s_host', 'Hired a host or shipper'],
      ['s_systems', 'Packing + scan-sheet system so shipping takes under 2 hours'],
      ['s_numbers', 'Tracking profit per show, not just sales'],
      ['s_win', 'Shared your win (testimonial)'],
    ],
  },
];

const ALL_ITEMS = PHASES.flatMap((p) => p.items.map(([key, title]) => ({ key, title, phase: p.key })));

module.exports = { PHASES, ALL_ITEMS };
