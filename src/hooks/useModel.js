// AiG — useModel.js
// Hook to initialise and run the selected AI model.
// Wraps svmModel.js + knn.js classical models behind a unified interface.
// Deep learning models (Phase 3) return a 'not_loaded' status.
//
// Usage:
//   const { modelReady, modelStatus, runModel, setModelType } = useModel(dbRecords);

import { useState, useCallback, useRef } from 'react';
import { trainSVM, trainNaiveBayes, trainLogisticRegression, trainDecisionTree, predictClassifier }
  from '../models/svmModel';
import { knnSearch, predictMaterial } from '../models/knn';

const DEEP_MODELS = new Set(['yolo', 'unet', 'cnn', 'vae']);

const PHASE2_STUBS = new Set(['randomForest', 'xgboost', 'autoencoder']);

export function useModel(dbRecords = []) {
  const [modelType,   setModelType]   = useState('ensemble');
  const [modelReady,  setModelReady]  = useState(false);
  const [modelStatus, setModelStatus] = useState('idle'); // 'idle'|'training'|'ready'|'error'|'stub'
  const [error,       setError]       = useState(null);
  const trainedRef = useRef(null); // { type, model }

  // ── Train / init model ────────────────────────────────────────────────────
  const initModel = useCallback(async (type = modelType) => {
    setModelType(type);
    setError(null);

    if (DEEP_MODELS.has(type)) {
      setModelStatus('stub');
      setModelReady(false);
      trainedRef.current = null;
      return;
    }

    if (PHASE2_STUBS.has(type)) {
      setModelStatus('stub');
      setModelReady(false);
      trainedRef.current = null;
      return;
    }

    // k-NN and ensemble don't need pre-training — they run at inference time
    if (type === 'knn' || type === 'ensemble') {
      trainedRef.current = { type, model: null };
      setModelReady(true);
      setModelStatus('ready');
      return;
    }

    // Classical models that need training
    if (dbRecords.length < 3) {
      setModelStatus('idle');
      setModelReady(false);
      return;
    }

    setModelStatus('training');
    await new Promise((r) => setTimeout(r, 0)); // yield to UI

    try {
      const records = dbRecords.filter((r) => Array.isArray(r.gpr_signature) && r.material);
      if (records.length < 3) throw new Error('Not enough labelled DB records to train.');

      const X = records.map((r) => r.gpr_signature);
      const y = records.map((r) => r.material);

      let model;
      if (type === 'svm')                model = trainSVM(X, y);
      else if (type === 'naiveBayes')    model = trainNaiveBayes(X, y);
      else if (type === 'logisticRegression') model = trainLogisticRegression(X, y);
      else if (type === 'decisionTree')  model = trainDecisionTree(X, y);
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

    // k-NN
    const knnMatches = knnSearch(featArr, dbRecords, 5, 'cosine');
    const knnResult  = predictMaterial(knnMatches);

    if (type === 'knn') return { ...knnResult, source: 'knn' };

    // Classical trained model
    if (type !== 'ensemble' && trainedRef.current?.model) {
      const clsResult = predictClassifier(trainedRef.current.model, featArr);
      return { ...clsResult, source: type };
    }

    // Ensemble — average k-NN + classifier scores
    if (type === 'ensemble') {
      const allMaterials = new Set([
        ...Object.keys(knnResult.scores ?? {}),
        ...(trainedRef.current?.model
          ? Object.keys(predictClassifier(trainedRef.current.model, featArr).scores ?? {})
          : []),
      ]);

      const clsResult = trainedRef.current?.model
        ? predictClassifier(trainedRef.current.model, featArr)
        : null;

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

    // Fallback to k-NN
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
