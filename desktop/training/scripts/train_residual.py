import json
import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

# Add parent directory to path for imports
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from differentiable_eq import DifferentiableEQ


class EQDataset(Dataset):
    """Dataset for EQ residual training."""

    def __init__(self, data_path: str):
        with open(data_path, "r") as f:
            self.data = json.load(f)

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, idx: int) -> tuple:
        item = self.data[idx]
        features = torch.tensor(item["features"], dtype=torch.float32)
        target = torch.tensor(item["target"], dtype=torch.float32)
        return features, target


class ResidualRegressor(nn.Module):
    """MLP for predicting 31-band EQ residuals."""

    def __init__(self, input_dim: int = 31, hidden_dim: int = 128, output_dim: int = 31):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, output_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def compute_residual_loss(
    predictions: torch.Tensor,
    targets: torch.Tensor,
    eq_model: DifferentiableEQ
) -> torch.Tensor:
    """
    Compute loss for EQ residual training.
    Combines MSE on residuals with regularization on EQ gains.
    """
    mse_loss = nn.MSELoss()
    residual_mse = mse_loss(predictions, targets)

    # Regularize EQ gain changes to prevent extreme adjustments
    eq_gains = eq_model.gains
    gain_reg = torch.mean(torch.square(eq_gains)) * 0.01

    return residual_mse + gain_reg


def train(
    dataset_path: str = "training_data.json",
    epochs: int = 100,
    batch_size: int = 32,
    learning_rate: float = 0.001,
    save_path: str = "models/residual_model_v1.pth"
):
    """Train the residual model."""
    print(f"Loading dataset from {dataset_path}")

    # Load dataset
    dataset = EQDataset(dataset_path)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    # Initialize models
    residual_model = ResidualRegressor()
    eq_model = DifferentiableEQ()

    # Optimizer for residual model only
    optimizer = optim.Adam(residual_model.parameters(), lr=learning_rate)

    # Training loop
    residual_model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        for batch_idx, (features, targets) in enumerate(dataloader):
            optimizer.zero_grad()

            # Predict residuals
            predictions = residual_model(features)

            # Compute loss
            loss = compute_residual_loss(predictions, targets, eq_model)

            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        avg_loss = total_loss / len(dataloader)
        if (epoch + 1) % 10 == 0:
            print(f"Epoch [{epoch + 1}/{epochs}], Loss: {avg_loss:.4f}")

    # Save model
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    torch.save(residual_model.state_dict(), save_path)
    print(f"Model saved to {save_path}")

    return residual_model


if __name__ == "__main__":
    # Check if training data exists, generate if not
    data_path = "training_data.json"
    if not os.path.exists(data_path):
        print("Generating mock training data...")
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from train_mock import generate_mock_data
        dataset = generate_mock_data(n_samples=500)
        with open(data_path, "w") as f:
            json.dump(dataset, f)
        print(f"Generated {len(dataset)} samples")

    # Train the model
    model = train()

    # Test the trained model
    print("\nTesting trained model...")
    test_input = torch.randn(1, 31)
    with torch.no_grad():
        predicted_residual = model(test_input)
    print(f"Input sample: {test_input[0, :5].numpy()}")
    print(f"Predicted residual (first 5 bands): {predicted_residual[0, :5].numpy()}")
