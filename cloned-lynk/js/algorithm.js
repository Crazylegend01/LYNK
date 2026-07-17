// ============================================================
// LYNK By Legends — Feed Ranking Algorithm
// Scores posts using: recency, engagement, social graph,
// faculty/department relevance, and content diversity.
// Pure browser ES module — no Node.js dependencies.
// ============================================================

const WEIGHTS = {
  recency:    0.40,
  engagement: 0.25,
  social:     0.20,
  relevance:  0.15,
};

const HALF_LIFE_HOURS = 18;

/**
 * Score a single post for the current user.
 * @param {object} post  - Firestore post data + id field
 * @param {object} ctx   - { friendSet: Set<uid>, faculty, department, university, seenAuthorIds: Map }
 * @returns {number} score 0-100
 */
export function scorePost(post, ctx) {
  const now = Date.now();
  const createdMs = post.createdAt?.toMillis?.() || now;
  const ageHours  = Math.max(0, (now - createdMs) / 3_600_000);

  const recencyScore = Math.exp(-Math.LN2 * ageHours / HALF_LIFE_HOURS) * 100;

  const rawEngagement = (post.likesCount || 0) * 1.2 + (post.commentsCount || 0) * 2.5;
  const engagementScore = Math.min(100, Math.log1p(rawEngagement) * 18);

  const isFriend = ctx.friendSet.has(post.authorId);
  const socialScore = isFriend ? 100 : 0;

  let relevanceScore = 0;
  if (post.faculty    && post.faculty    === ctx.faculty)     relevanceScore += 60;
  if (post.department && post.department === ctx.department)  relevanceScore += 40;
  if (post.university && post.university === ctx.university)  relevanceScore += 20;
  relevanceScore = Math.min(100, relevanceScore);

  const authorCount = ctx.seenAuthorIds.get(post.authorId) || 0;
  const diversityPenalty = Math.min(30, authorCount * 12);

  const total =
    recencyScore    * WEIGHTS.recency    +
    engagementScore * WEIGHTS.engagement +
    socialScore     * WEIGHTS.social     +
    relevanceScore  * WEIGHTS.relevance  -
    diversityPenalty;

  return Math.max(0, total);
}

/**
 * Rank a list of posts for the current user.
 * @param {Array}  posts - array of { id, ...postData } objects
 * @param {object} ctx   - context object (see scorePost)
 * @returns {Array} sorted posts, highest score first
 */
export function rankPosts(posts, ctx) {
  const seenAuthorIds = new Map();
  return posts
    .map(post => {
      const score = scorePost(post, { ...ctx, seenAuthorIds });
      const count = (seenAuthorIds.get(post.authorId) || 0) + 1;
      seenAuthorIds.set(post.authorId, count);
      return { ...post, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

/**
 * Build the social-graph context needed for scoring.
 * Accepts Firestore functions directly — no dynamic imports needed.
 *
 * @param {object} firestoreDb   - Firestore `db` instance
 * @param {string} uid           - Current user's UID
 * @param {object} userData      - Current user's Firestore data
 * @param {object} firestoreFns  - { collection, query, where, getDocs } from firebase-firestore
 * @returns {Promise<object>}    ctx ready for rankPosts()
 */
export async function buildRankingContext(firestoreDb, uid, userData, firestoreFns) {
  let friendSet = new Set();
  try {
    const { collection, query, where, getDocs } = firestoreFns;
    const [fromSnap, toSnap] = await Promise.all([
      getDocs(query(collection(firestoreDb, 'friends'), where('from', '==', uid), where('status', '==', 'accepted'))),
      getDocs(query(collection(firestoreDb, 'friends'), where('to',   '==', uid), where('status', '==', 'accepted'))),
    ]);
    fromSnap.docs.forEach(d => friendSet.add(d.data().to));
    toSnap.docs.forEach(d => friendSet.add(d.data().from));
  } catch (_) {}

  return {
    friendSet,
    faculty:    userData.faculty    || '',
    department: userData.department || '',
    university: userData.university || '',
    seenAuthorIds: new Map(),
  };
}
