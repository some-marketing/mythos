'use strict';

module.exports = {
  phrases: [
    {
      text: 'make a plan for the routing hook work',
      command: '/plan-task "<task summary>"',
      target: 'plan-task'
    },
    {
      text: 'make a plan',
      command: '/plan-task "<task summary>"',
      target: 'plan-task'
    },
    {
      text: 'create a concept bundle first, then a task plan',
      command: '/concept-init <concept-id> --bundle',
      target: 'concept-init'
    },
    {
      text: 'run the QA for the wordpress fixes',
      command: '/fw-wordpress-qa',
      target: 'fw-wordpress-qa'
    },
    {
      text: 'run the QA',
      command: '/fw-wordpress-qa',
      target: 'fw-wordpress-qa'
    },
    {
      text: 'turn this into a framework',
      command: '/capture-task <successful-work-scope>',
      target: 'capture-task'
    },
    {
      text: 'make this reusable',
      command: '/capture-task <successful-work-scope>',
      target: 'capture-task'
    },
    {
      text: 'run the framework for this project',
      command: '/run-framework <service/framework> <project>',
      target: 'run-framework'
    },
    {
      text: 'scaffold a framework candidate',
      command: '/scaffold-framework <capture-id>',
      target: 'scaffold-framework'
    },
    {
      text: 'framework scaffold',
      command: '/scaffold-framework <capture-id>',
      target: 'scaffold-framework'
    },
    {
      text: 'replay the framework',
      command: '/replay-framework <service/framework>',
      target: 'replay-framework'
    },
    {
      text: 'promote the framework',
      command: '/promote-framework <service/framework>',
      target: 'promote-framework'
    },
    {
      text: 'framework promote',
      command: '/promote-framework <service/framework>',
      target: 'promote-framework'
    },
    {
      text: 'improve the framework',
      command: '/improve-framework <service/framework>',
      target: 'improve-framework'
    },
    {
      text: 'generate the harness for the framework',
      command: '/generate-harness <service/framework>',
      target: 'generate-harness'
    },
    {
      text: 'remember this',
      command: '/remember',
      target: 'remember'
    },
    {
      text: 'save and mirror this session',
      command: '/shutdown --system',
      target: 'shutdown'
    },
    {
      text: 'close this out',
      command: '/shutdown --system',
      target: 'shutdown'
    },
    {
      text: 'what next',
      command: '/whats-next',
      target: 'whats-next'
    },
    {
      text: 'what should i do next',
      command: '/whats-next',
      target: 'whats-next'
    },
    {
      text: 'review this first',
      command: '/review-task-plan <task-id>',
      target: 'review-task-plan'
    },
    {
      text: 'ship this',
      command: '/run-plan <task-id>',
      target: 'run-plan'
    },
    {
      text: 'proceed with recommendation',
      command: '/run-plan <task-id>',
      target: 'run-plan'
    }
  ]
};
