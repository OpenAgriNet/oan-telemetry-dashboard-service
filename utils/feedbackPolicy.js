// Apply the same rule to lists, totals, charts and session/user reports.
// Existing invalid rows stay in the database for investigation.
// Match JavaScript trim(), including nonbreaking spaces and the byte-order mark.
const nonblankComment = String.raw`U&'[^\0009\000A\000B\000C\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'`;

function validFeedbackSql(alias = '') {
  if (alias && !/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  const prefix = alias ? `${alias}.` : '';
  return `(${prefix}feedbacktype = 'like' OR (${prefix}feedbacktype = 'dislike'
    AND ${prefix}feedbacktext ~ ${nonblankComment}))`;
}

module.exports = { validFeedbackSql };
