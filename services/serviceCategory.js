// Use the same classification for service summaries and their call drilldowns.
function categoryExpression(tableAlias = "") {
  return `COALESCE(
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}request_payload #>> '{message,order,items,0,category_ids,0}',
    ${tableAlias}response_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}response_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}response_payload #>> '{message,order,items,0,category_ids,0}',
    CASE WHEN ${tableAlias}service = 'mh-provider-backend'
      AND ${tableAlias}request_payload #>> '{message,intent,provider,id}' = 'smam'
      AND ${tableAlias}request_payload #>> '{message,intent,item,descriptor,code}' = 'application_status'
      THEN 'smam-application-status' END,
    '(unclassified)'
  )`;
}

module.exports = { categoryExpression };
