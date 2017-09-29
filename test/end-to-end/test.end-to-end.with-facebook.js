'use strict';

const assert = require('assert');
const openwhisk = require('openwhisk');

const safeExtractErrorMessage = require('./../utils/helper-methods.js').safeExtractErrorMessage;
const facebookBindings = require('./../resources/bindings/facebook-bindings.json').facebook;
const cloudantBindings = require('./../resources/bindings/cloudant-bindings.json');

const clearContextDb = require('./../utils/cloudant-utils.js').clearContextDb;

const carDashboardReplyWelcome = 'Hi. It looks like a nice drive today. What would you like me to do?  ';
const carDashboardReplyLights = "I'll turn on the lights for you.";

const pipelineName = process.env.__TEST_PIPELINE_NAME;

/** Function allows tests to sleep for certain amount of time
*/
function sleep(time) {
  return new Promise(resolve => {
    return setTimeout(resolve, time);
  });
}
/**
 * Facebook prerequisites test suite verifies the Facebook package is properly deployed in OpenWhisk
 */
describe('End-to-End tests: Facebook prerequisites', () => {
  const ow = openwhisk();

  const requiredActions = [
    `${pipelineName}_facebook/post`,
    `${pipelineName}_facebook/receive`,
    `${pipelineName}_facebook/batched_messages`,
    `${pipelineName}_starter-code/normalize-conversation-for-facebook`,
    `${pipelineName}_starter-code/normalize-facebook-for-conversation`
  ];

  requiredActions.forEach(action => {
    it(`${action} action is deployed in OpenWhisk namespace`, () => {
      return ow.actions.get({ name: action }).then(
        () => {},
        error => {
          assert(
            false,
            `${action}, ${safeExtractErrorMessage(error)} Try running setup scripts again.`
          );
        }
      );
    });
  });
});

describe('End-to-End tests: Facebook as channel package', () => {
  const ow = openwhisk();
  const actionFacebookPipeline = 'test-pipeline-facebook';
  const actionFacebookBatchedMessages = `${pipelineName}_facebook/batched_messages`;
  const facebookWebhook = `${pipelineName}_facebook/receive`;
  let params = {};
  const activationId = 'xxxxxxx';

  const expectedReceiveResult = {
    text: 200,
    activationId,
    actionName: actionFacebookPipeline,
    message: `Response code 200 above only tells you that receive action was invoked successfully. However, it does not really say if ${actionFacebookPipeline} was invoked successfully. Please use ${activationId} to get more details about this invocation.`
  };
  const expectedPostResult = {
    params: {
      message: {
        text: carDashboardReplyWelcome
      },
      recipient: {
        id: facebookBindings.sender.id
      }
    },
    text: 200,
    url: 'https://graph.facebook.com/v2.6/me/messages'
  };

  beforeEach(done => {
    params = {
      sub_pipeline: actionFacebookPipeline,
      batched_messages: actionFacebookBatchedMessages,
      __ow_headers: {
        'x-hub-signature': 'sha1=7022aaa4676f7355e712d2427e204ff3f7be0e91'
      },
      object: 'page',
      entry: [
        {
          id: facebookBindings.sender.id,
          time: 1458692752478,
          messaging: [
            {
              sender: facebookBindings.sender,
              recipient: facebookBindings.recipient,
              message: {
                text: 'hello, world!'
              }
            }
          ]
        }
      ]
    };
    return done();
  });

  // Under validated circumstances, the channel (mocked parameters here) will send parameters
  // to facebook/receive. The architecture will flow the response to facebook/post, and
  // facebook/post will send its response to this ow.action invocation.
  it('system works under validated circumstances', done => {
    ow.actions
      .invoke({
        name: facebookWebhook,
        params,
        blocking: true,
        result: true
      })
      .then(
        success => {
          try {
            // The expected Result is modified since the activation id is generated
            // dynamically and in order to pass the test, we need to make sure that
            // the activation id is the same.
            const modifiedExpectedResult = Object.assign(
              {},
              expectedReceiveResult
            );
            modifiedExpectedResult.activationId = success.activationId;
            modifiedExpectedResult.message = modifiedExpectedResult.message.replace(
              activationId,
              success.activationId
            );
            assert.deepEqual(success, modifiedExpectedResult);

            // Get activation of the subpipeline invocation
            const successActivationId = success.activationId;
            return successActivationId;
          } catch (e) {
            return done(e);
          }
        },
        error => {
          return done(error);
        }
      )
      .then(successActivationId => {
        // Sleep for 10 seconds to ensure that the activation id
        // has been created
        sleep(10000).then(() => {
          // After the wait, get the response of the activation
          return ow.activations
            .get({
              activationId: successActivationId
            })
            .then(
              result => {
                try {
                  if (result.response.result) {
                    assert.deepEqual(
                      result.response.result,
                      expectedPostResult
                    );
                    return done();
                  }
                  assert(false, 'Openwhisk Action did not return a reponse');
                  return done();
                } catch (e) {
                  return done(e);
                }
              },
              error => {
                return done(error);
              }
            )
            .catch(e => {
              return done(e);
            });
        });
      })
      .catch(e => {
        return e;
      });
  })
    .timeout(40000)
    .retries(1);
});

describe('End-to-End tests: Facebook as channel package - for batched messages', () => {
  const ow = openwhisk();
  const actionFacebookPipeline = 'test-pipeline-facebook';
  const actionFacebookBatchedMessages = `${pipelineName}_facebook/batched_messages`;
  const facebookWebhook = `${pipelineName}_facebook/receive`;
  const activationId = 'xxxxxxx';
  let params = {};

  const expectedReceiveResult = {
    text: 200,
    activationId,
    actionName: actionFacebookBatchedMessages,
    message: `Response code 200 above only tells you that receive action was invoked successfully. However, it does not really say if ${actionFacebookBatchedMessages} was invoked successfully. Please use ${activationId} to get more details about this invocation.`
  };

  const expectedBatchedResult = {
    failedActionInvocations: [
      {
        errorMessage: 'Recipient id: 185643828639058 , Sender id: undefined -- Action invocation failed, API returned error code. Check syntax errors? No Facebook sender_id found in raw data.',
        activationId: ''
      }
    ],
    successfulActionInvocations: [
      {
        successResponse: {
          text: 200,
          params: {
            recipient: facebookBindings.sender,
            message: { text: carDashboardReplyWelcome }
          },
          url: 'https://graph.facebook.com/v2.6/me/messages'
        },
        activationId: ''
      },
      {
        successResponse: {
          text: 200,
          params: {
            recipient: facebookBindings.sender,
            message: { text: carDashboardReplyWelcome }
          },
          url: 'https://graph.facebook.com/v2.6/me/messages'
        },
        activationId: ''
      }
    ]
  };

  beforeEach(() => {
    params = {
      sub_pipeline: actionFacebookPipeline,
      batched_messages: actionFacebookBatchedMessages,
      __ow_headers: {
        'x-hub-signature': 'sha1=3bcbbbd11ad8ef728dba5d9d903e55abdea24738'
      },
      object: 'page',
      entry: [
        {
          id: facebookBindings.recipient.id,
          time: 1458692752478,
          messaging: [
            {
              sender: '12345',
              recipient: facebookBindings.recipient,
              timestamp: 1458692752467,
              message: {
                text: 'hi'
              }
            },
            {
              sender: facebookBindings.sender,
              recipient: facebookBindings.recipient,
              timestamp: 1458692752468,
              message: {
                text: 'hi'
              }
            }
          ]
        },
        {
          id: facebookBindings.recipient.id,
          time: 1458692752489,
          messaging: [
            {
              sender: facebookBindings.sender,
              recipient: facebookBindings.recipient,
              timestamp: 1458692752488,
              message: {
                text: 'hi'
              }
            }
          ]
        }
      ]
    };
  });

  // Under validated circumstances, the channel (mocked parameters here) will send parameters
  // to facebook/receive. The architecture will flow the response to facebook/post, and
  // facebook/post will send its response to this ow.action invocation.
  it('validate facebook channel package works for batched Messages', done => {
    ow.actions
      .invoke({
        name: facebookWebhook,
        params,
        blocking: true,
        result: true
      })
      .then(
        success => {
          try {
            // The expected Result is modified since the activation id is generated
            // dynamically and in order to pass the test, we need to make sure that
            // the activation id is the same.
            const modifiedExpectedResult = Object.assign(
              {},
              expectedReceiveResult
            );
            modifiedExpectedResult.activationId = success.activationId;
            modifiedExpectedResult.message = modifiedExpectedResult.message.replace(
              activationId,
              success.activationId
            );
            assert.deepEqual(success, modifiedExpectedResult);

            // Get batched messages action invocation id
            const successActivationId = success.activationId;
            return successActivationId;
          } catch (e) {
            return done(e);
          }
        },
        error => {
          return done(error);
        }
      )
      .then(successActivationId => {
        // Sleep for 10 seconds to ensure that the activation id
        // has been created
        sleep(10000).then(() => {
          // After the wait, get the response of the activation
          ow.activations
            .get({
              activationId: successActivationId,
              bocking: true
            })
            .then(
              result => {
                try {
                  const res = result.response.result;
                  if (res) {
                    // Replace the activation ids with dynamically
                    // generated activation ids present in the response
                    expectedBatchedResult.successfulActionInvocations[
                      0
                    ].activationId = res.successfulActionInvocations[
                      0
                    ].activationId;
                    expectedBatchedResult.successfulActionInvocations[
                      1
                    ].activationId = res.successfulActionInvocations[
                      1
                    ].activationId;
                    expectedBatchedResult.failedActionInvocations[
                      0
                    ].activationId = res.failedActionInvocations[
                      0
                    ].activationId;
                    assert.deepEqual(res, expectedBatchedResult);
                    return done();
                  }
                  assert(false, 'Openwhisk Action did not return a reponse');
                  return done();
                } catch (e) {
                  return done(e);
                }
              },
              error => {
                return done(error);
              }
            );
        });
      })
      .catch(e => {
        return e;
      });
  })
    .timeout(40000)
    .retries(1);
});

// --------------------SKIPPED CONTEXT TESTS BELOW ----------------------------//

describe.skip('End-to-End tests: Facebook context package works', () => {
  const ow = openwhisk();
  const facebookWebhook = `${pipelineName}_facebook/receive`;
  const contextPipeline = 'test-pipeline-context-facebook';
  let params = {};

  const expAfterTurn1 = {
    text: 200,
    failedActionInvocations: [],
    successfulActionInvocations: [
      {
        successResponse: {
          text: 200,
          params: {
            batched_messages: `${pipelineName}_facebook/batched_messages`,
            recipient: { id: facebookBindings.sender.id },
            message: {
              text: carDashboardReplyWelcome
            }
          },
          url: 'https://graph.facebook.com/v2.6/me/messages'
        },
        activationId: ''
      }
    ]
  };

  const expAfterTurn2 = {
    text: 200,
    failedActionInvocations: [],
    successfulActionInvocations: [
      {
        successResponse: {
          text: 200,
          params: {
            batched_messages: `${pipelineName}_facebook/batched_messages`,
            recipient: { id: facebookBindings.sender.id },
            message: {
              text: carDashboardReplyLights
            }
          },
          url: 'https://graph.facebook.com/v2.6/me/messages'
        },
        activationId: ''
      }
    ]
  };

  beforeEach(() => {
    params = {
      sub_pipeline: '',
      __ow_headers: {
        'x-hub-signature': 'sha1=7022aaa4676f7355e712d2427e204ff3f7be0e91'
      },
      object: 'page',
      entry: [
        {
          id: facebookBindings.sender.id,
          time: 1458692752478,
          messaging: [
            {
              sender: facebookBindings.sender,
              recipient: facebookBindings.recipient,
              message: {
                text: 'hello, world!'
              }
            }
          ]
        }
      ]
    };
  });

  // Under validated circumstances, context package should load and save context
  // to complete a single-turn conversation successfully.
  it('context pipeline works for single Conversation turn', () => {
    return clearContextDb(
      cloudantBindings.database.context.name,
      cloudantBindings.url
    ).then(() => {
      params.sub_pipeline = contextPipeline;
      return ow.actions
        .invoke({
          name: facebookWebhook,
          result: true,
          blocking: true,
          params
        })
        .then(
          result => {
            expAfterTurn1.successfulActionInvocations[
              0
            ].activationId = result.successfulActionInvocations[0].activationId;
            return assert.deepEqual(result, expAfterTurn1);
          },
          error => {
            return assert(false, safeExtractErrorMessage(error));
          }
        );
    });
  })
    .timeout(8000)
    .retries(4);

  // Under validated circumstances, context package should load and save context
  // to complete a multi-turn conversation successfully.
  it('context pipeline works for multiple Conversation turns', () => {
    return clearContextDb(
      cloudantBindings.database.context.name,
      cloudantBindings.url
    ).then(() => {
      params.sub_pipeline = contextPipeline;
      return ow.actions
        .invoke({
          name: facebookWebhook,
          result: true,
          blocking: true,
          params
        })
        .then(result => {
          expAfterTurn1.successfulActionInvocations[
            0
          ].activationId = result.successfulActionInvocations[0].activationId;
          assert.deepEqual(result, expAfterTurn1);
          // Change the input text for the second turn.
          params.entry[0].messaging[0].message.text = 'Turn on the lights';
          // Change the signature header value for the second turn.
          params.__ow_headers[
            'x-hub-signature'
          ] = 'sha1=dc7583f847527eccd75defd236e8daa302abb448';
          // Invoke the context pipeline sequence again.
          // The context package should read the updated context from the previous turn.
          return ow.actions.invoke({
            name: facebookWebhook,
            result: true,
            blocking: true,
            params
          });
        })
        .then(result => {
          expAfterTurn2.successfulActionInvocations[
            0
          ].activationId = result.successfulActionInvocations[0].activationId;
          return assert.deepEqual(result, expAfterTurn2);
        })
        .catch(err => {
          return assert(false, safeExtractErrorMessage(err));
        });
    });
  })
    .timeout(8000)
    .retries(4);
});
