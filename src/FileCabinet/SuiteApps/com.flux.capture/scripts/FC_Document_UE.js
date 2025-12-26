/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/task', 'N/log', '/SuiteApps/com.flux.capture/lib/FC_LicenseGuard'], function(task, log, License) {

    const SCRIPT_IDS = {
        PROCESS_DOCUMENTS_MR: 'customscript_fc_process_docs_mr',
        PROCESS_DOCUMENTS_DEPLOY: 'customdeploy_fc_process_docs_mr'
    };

    function beforeLoad(context) {
        log.debug('FC_Document_UE.beforeLoad', 'Type: ' + context.type);
    }

    function afterSubmit(context) {
        // LICENSE CHECK - Block if unlicensed
        try {
            License.require();
        } catch (licError) {
            log.error('FC_Document_UE', 'License validation failed - blocking operation');
            return;
        }

        log.audit('FC_Document_UE.afterSubmit', 'Triggered - Type: ' + context.type);

        if (context.type !== context.UserEventType.CREATE) {
            log.debug('FC_Document_UE.afterSubmit', 'Skipping - not CREATE');
            return;
        }

        try {
            var documentId = context.newRecord.id;
            var status = context.newRecord.getValue({ fieldId: 'custrecord_flux_status' });

            log.audit('FC_Document_UE.afterSubmit', 'Document: ' + documentId + ', Status: ' + status);

            if (String(status) !== '1') {
                log.debug('FC_Document_UE.afterSubmit', 'Skipping - status not PENDING');
                return;
            }

            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: SCRIPT_IDS.PROCESS_DOCUMENTS_MR,
                deploymentId: SCRIPT_IDS.PROCESS_DOCUMENTS_DEPLOY
            });

            var taskId = mrTask.submit();
            log.audit('FC_Document_UE.afterSubmit', 'MapReduce triggered: ' + taskId);

        } catch (e) {
            log.error('FC_Document_UE.afterSubmit', 'Error: ' + e.message);
        }
    }

    return {
        beforeLoad: beforeLoad,
        afterSubmit: afterSubmit
    };
});
