'use strict';

const scorecardModule = require('./scorecard');
const promotionController = require('./promotion-controller');

module.exports = {
  // scorecard.js
  SCORECARD_DIR: scorecardModule.SCORECARD_DIR,
  TIERS: scorecardModule.TIERS,
  RESTRICTED_TIER: scorecardModule.RESTRICTED_TIER,
  ALL_TIERS: scorecardModule.ALL_TIERS,
  DEMOTION_TRIGGERS: scorecardModule.DEMOTION_TRIGGERS,
  PROMOTION_THRESHOLDS: scorecardModule.PROMOTION_THRESHOLDS,
  createEmptyScorecard: scorecardModule.createEmptyScorecard,
  loadScorecard: scorecardModule.loadScorecard,
  saveScorecard: scorecardModule.saveScorecard,
  updateScorecard: scorecardModule.updateScorecard,
  recomputeMetrics: scorecardModule.recomputeMetrics,
  detectDemotionTriggers: scorecardModule.detectDemotionTriggers,
  scorecardDir: scorecardModule.scorecardDir,
  scorecardPath: scorecardModule.scorecardPath,

  // promotion-controller.js
  DECISION_DIR: promotionController.DECISION_DIR,
  CONTROLLER_VERSION: promotionController.CONTROLLER_VERSION,
  TIER_CAPABILITIES: promotionController.TIER_CAPABILITIES,
  evaluatePromotion: promotionController.evaluatePromotion,
  checkPromotionThresholds: promotionController.checkPromotionThresholds,
  computeGrantedCapabilities: promotionController.computeGrantedCapabilities,
  checkDistinctIntelligenceValidation: promotionController.checkDistinctIntelligenceValidation,
  loadTrustTierPolicy: promotionController.loadTrustTierPolicy,
  mapToGovernanceTier: promotionController.mapToGovernanceTier,
  checkTierValidationIndependence: promotionController.checkTierValidationIndependence,
  emitPromotionTrace: promotionController.emitPromotionTrace,

  // scorecard.js (new)
  createScorecardFromRegistry: scorecardModule.createScorecardFromRegistry
};
