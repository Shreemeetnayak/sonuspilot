import json
import numpy as np

# Simulate FMA-like features (31-band spectral balance)
def generate_mock_data(n_samples=100):
    data = []
    for _ in range(n_samples):
        features = np.random.rand(31)
        # Synthesize target residual: reduce harshness if high bands > 0.5
        target = np.array([-1.5 if (i > 20 and f > 0.5) else (1.0 if (i < 5 and f < 0.2) else 0.0) for i, f in enumerate(features)])
        data.append({"features": features.tolist(), "target": target.tolist()})
    return data

if __name__ == "__main__":
    dataset = generate_mock_data()
    with open("training_data.json", "w") as f:
        json.dump(dataset, f)
    print("Mock dataset generated.")
