/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Flux Capture - Document User Event
 * Triggers MapReduce processing when new documents are created
 */
define(['N/task', 'N/log', 'N/runtime'], function(task, log, runtime) {

    'use strict';

    const SCRIPT_IDS = {
        PROCESS_DOCUMENTS_MR: 'customscript_fc_process_docs_mr',
        PROCESS_DOCUMENTS_DEPLOY: 'customdeploy_fc_process_docs_mr'
    };

    /**
     * After a new document is created, trigger the MapReduce to process it
     */
    function afterSubmit(context) {
        // Only trigger on create (not edit/delete)
        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        try {
            var newRecord = context.newRecord;
            var documentId = newRecord.id;
            var status = newRecord.getValue({ fieldId: 'custrecord_flux_status' });
            var source = newRecord.getValue({ fieldId: 'custrecord_flux_source' });

            log.audit('FC_Document_UE', 'New document created: ' + documentId + ', status: ' + status + ', source: ' + source);

            // Only trigger for PENDING status (1)
            if (String(status) !== '1') {
                log.debug('FC_Document_UE', 'Skipping - document not in PENDING status');
                return;
            }

            // Check remaining governance
            var remainingUsage = runtime.getCurrentScript().getRemainingUsage();
            if (remainingUsage < 100) {
                log.debug('FC_Document_UE', 'Low governance, skipping MapReduce trigger');
                return;
            }

            // Trigger the MapReduce
            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: SCRIPT_IDS.PROCESS_DOCUMENTS_MR,
                deploymentId: SCRIPT_IDS.PROCESS_DOCUMENTS_DEPLOY
            });

            var taskId = mrTask.submit();
            log.audit('FC_Document_UE', 'MapReduce triggered: ' + taskId + ' for document: ' + documentId);

        } catch (e) {
            // Don't fail the document creation - just log the error
            log.error('FC_Document_UE', 'Failed to trigger processing: ' + e.message);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
