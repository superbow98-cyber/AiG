# AI Methods Reference

## Classical ML — Phase 2 (no labelled training data needed)
| Method | File | Role |
|--------|------|------|
| PCA | pcaModel.js | Dimensionality reduction, preprocessing |
| ICA | icaModel.js | Signal separation, clutter removal |
| Autoencoder | autoencoderModel.js | Unsupervised clutter removal |
| K-Means | clusterModels.js | Anomaly clustering |
| DBSCAN | clusterModels.js | Noise-resistant clustering |
| SOM | clusterModels.js | Pattern visualisation |
| SVM | svmModel.js | Classification (small datasets) |
| Random Forest | randomForest.js | Robust classification |
| XGBoost | xgboost.js | High accuracy feature-based |
| k-NN | knn.js | GPR+XRF database similarity matching |
| Decision Tree | svmModel.js | Interpretable classification |
| Naïve Bayes | svmModel.js | Fast signal classification |
| Logistic Regression | svmModel.js | Binary target/no-target |
| AdaBoost | randomForest.js | Small dataset ensemble |
| Bayesian Networks | bayesianNet.js | Confidence estimation |
| Fuzzy Logic | fuzzyLogic.js | Soil characterisation |

## Deep Learning — Phase 3 (requires labelled data)
| Method | File | Role |
|--------|------|------|
| YOLOv5/v8 | deepLearningLoader.js | Hyperbola & object detection |
| Faster R-CNN | deepLearningLoader.js | High-precision detection |
| U-Net | deepLearningLoader.js | Pixel-level segmentation |
| CNN / ResNet / EfficientNet | deepLearningLoader.js | Radargram classification |
| LSTM / GRU | deepLearningLoader.js | A-scan sequential analysis |
| ViT / Swin Transformer | deepLearningLoader.js | Global feature learning |
| VAE | deepLearningLoader.js | Signature matching |
