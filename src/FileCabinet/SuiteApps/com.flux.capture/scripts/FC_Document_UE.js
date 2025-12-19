/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Flux Capture - Document User Event
 * Triggers MapReduce processing when new documents are created
 */
define(['N/task', 'N/log'], function(task, log) {

    'use strict';

    const SCRIPT_IDS = {
        PROCESS_DOCUMENTS_MR: 'customscript_fc_process_docs_mr',
        PROCESS_DOCUMENTS_DEPLOY: 'customdeploy_fc_process_docs_mr'
    };

    /**
     * After a new document is created, trigger the MapReduce to process it
     */
    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        try {
            var documentId = context.newRecord.id;
            var status = context.newRecord.getValue({ fieldId: 'custrecord_flux_status' });

            log.audit('FC_Document_UE', 'New document created: ' + documentId + ', status: ' + status);

            // Only trigger for PENDING status (1)
            if (String(status) !== '1') {
                return;
            }

            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: SCRIPT_IDS.PROCESS_DOCUMENTS_MR,
                deploymentId: SCRIPT_IDS.PROCESS_DOCUMENTS_DEPLOY
            });

            var taskId = mrTask.submit();
            log.audit('FC_Document_UE', 'MapReduce triggered: ' + taskId);

        } catch (e) {
            log.error('FC_Document_UE', 'Failed to trigger processing: ' + e.message);
        }
    }

    return { afterSubmit: afterSubmit };
});
