// Use the same classification for service summaries and their call drilldowns.
function categoryExpression(tableAlias = "") {
  return `COALESCE(
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}request_payload #>> '{message,order,items,0,category_ids,0}',
    ${tableAlias}response_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}response_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}response_payload #>> '{message,order,items,0,category_ids,0}',
    '(unclassified)'
  )`;
}

// These requests can reach MH's provider endpoint, but are not MH business
// services. Keep other categories, including unknown ones, visible for review.
function includeProviderRequestExpression(tableAlias = "") {
  return `(${tableAlias}service <> 'mh-provider-backend' OR NOT (
    lower(trim(${categoryExpression(tableAlias)})) IN ('advisory-agri-qdrant', 'smam', 'smam-application-status')
    OR lower(trim(COALESCE(${tableAlias}request_payload #>> '{message,intent,provider,id}', ''))) = 'smam'
    OR lower(trim(COALESCE(${tableAlias}request_payload #>> '{message,intent,provider,descriptor,code}', ''))) = 'smam'
  ))`;
}

module.exports = { categoryExpression, includeProviderRequestExpression };
