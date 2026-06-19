// AiG — useModel.js
// Hook to initialise and run the selected AI model.
// Wraps svmModel.js + knn.js + randomForest.js + xgboost.js behind a unified interface.
// Deep learning models (Phase 3) return a 'stub' status.
//
// Usage:
//   const { modelReady, modelStatus, runModel, initModel } = useModel(dbRecords);

import { useState, useCallback, useRef } from 'react';
import { trainSVM, trainNaiveBayes, trainLogisticRegression, trainDecisionTree, predictClassifier }
  from '../models/svmModel';
import { knnSearch, predictMaterial } from '../models/knn';
import { trainRandomForest, trainAdaBoost, predictRF } from '../models/randomForest';
import { trainXGBoost, predictXGB } from '../models/xgboost';

const DEEP_MODELS  = new Set(['yolo', 'unet', 'cnn', 'vae']);
const PHASE2_STUBS = new Set(['autoencoder']);

export function useModel(dbRecords = []) {
  const [modelType,   setModelTypeState] = useState('ensemble');
  const [modelReady,  setModelReady]     = useState(false);
  const [modelStatus, setModelStatus]    = useState('idle'); // 'idle'|'training'|'ready'|'error'|'stub'
  const [error,       setError]          = useState(null);
  const trainedRef = useRef(null); // { type, model }

  // ── Train / init model ────────────────────────────────────────────────────
  const initModel = useCallback(async (type = modelType) => {
    setModelTypeState(type);
    setError(null);

    // Phase 3 deep learning — not yet implemented
    if (DEEP_MODELS.has(type)) {
      setModelStatus('stub');
      setModelReady(false);
      trainedRef.current = null;
      return;
    }

    // Phase 2 remaining stubs
    if (PHASE2_STUBS.has(type)) {
      setModelStatus('stub');
      setModelReady(false);
      trainedRef.current = null;
      return;
    }

    // k-NN and ensemble — no pre-training needed, run at inference time
    if (type === 'knn' || type === 'ensemble') {
      trainedRef.current = { type, model: null };
      setModelReady(true);
      setModelStatus('ready');
      return;
    }

    // All other models need DB records to train
    if (dbRecords.length < 3) {
      setModelStatus('idle');
      setModelReady(false);
      return;
    }

    setModelStatus('training');
    await new Promise((r) => setTimeout(r, 0)); // yield to UI before heavy work

    try {
      const records = dbRecords.filter((r) => Array.isArray(r.gpr_signature) && r.material);
      if (records.length < 3) throw new Error('Not enough labelled DB records to train.');

      const X = records.map((r) => r.gpr_signature);
      const y = records.map((r) => r.material);

      let model;
      if      (type === 'svm')               model = trainSVM(X, y);
      else if (type === 'naiveBayes')         model = trainNaiveBayes(X, y);
      else if (type === 'logisticRegression') model = trainLogisticRegression(X, y);
      else if (type === 'decisionTree')       model = trainDecisionTree(X, y);
      else if (type === 'randomForest')       model = trainRandomForest(X, y);
      else if (type === 'adaBoost')           model = trainAdaBoost(X, y);
      else if (type === 'xgboost')            model = trainXGBoost(X, y);
      else throw new Error(`Unknown model type: ${type}`);

      trainedRef.current = { type, model };
      setModelReady(true);
      setModelStatus('ready');
    } catch (e) {
      setError(e.message);
      setModelStatus('error');
      setModelReady(false);
    }
  }, [modelType, dbRecords]);

  // ── Run inference on one feature vector ───────────────────────────────────
  const runModel = useCallback((features, type = modelType) => {
    if (DEEP_MODELS.has(type) || PHASE2_STUBS.has(type)) {
      return { label: 'unknown', confidence: 0, scores: {}, source: 'stub' };
    }

    const featArr = Array.from(features);

    // Always run k-NN — used as base for ensemble too
    const knnMatches = knnSearch(featArr, dbRecords, 5, 'cosine');
    const knnResult  = predictMaterial(knnMatches);

    if (type === 'knn') return { ...knnResult, source: 'knn' };

    // Random Forest / AdaBoost
    if (type === 'randomForest' || type === 'adaBoost') {
      if (!trainedRef.current?.model)
        return { label: 'unknown', confidence: 0, scores: {}, source: 'stub' };
      return { ...predictRF(trainedRef.current.model, featArr), source: type };
    }

    // XGBoost
    if (type === 'xgboost') {
      if (!trainedRef.current?.model)
        return { label: 'unknown', confidence: 0, scores: {}, source: 'stub' };
      return { ...predictXGB(trainedRef.current.model, featArr), source: 'xgboost' };
    }

    // Classical trained model (svm / naiveBayes / logisticRegression / decisionTree)
    if (type !== 'ensemble' && trainedRef.current?.model) {
      const clsResult = predictClassifier(trainedRef.current.model, featArr);
      return { ...clsResult, source: type };
    }

    // Ensemble — average k-NN votes + classifier scores
    if (type === 'ensemble') {
      const clsResult = trainedRef.current?.model
        ? predictClassifier(trainedRef.current.model, featArr)
        : null;

      const allMaterials = new Set([
        ...Object.keys(knnResult.scores ?? {}),
        ...Object.keys(clsResult?.scores ?? {}),
      ]);

      const scores = {};
      for (const mat of allMaterials) {
        const knnScore = knnResult.scores?.[mat]  ?? 0;
        const clsScore = clsResult?.scores?.[mat] ?? 0;
        scores[mat] = clsResult ? (knnScore + clsScore) / 2 : knnScore;
      }

      const label      = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
      const confidence = scores[label] ?? 0;
      return { label, confidence, scores, top_matches: knnMatches, source: 'ensemble' };
    }

    // Fallback
    return { ...knnResult, source: 'knn_fallback' };
  }, [modelType, dbRecords]);

  return {
    modelType,
    modelReady,
    modelStatus,
    error,
    initModel,
    runModel,
    setModelType: initModel, // alias — calling setModelType also trains
  };
}
