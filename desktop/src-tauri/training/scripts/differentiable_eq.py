import torch
import torch.nn as nn
import numpy as np

class DifferentiableEQ(nn.Module):
    def __init__(self, bands=31):
        super().__init__()
        self.bands = bands
        # Initial gains: 0dB
        self.gains = nn.Parameter(torch.zeros(bands))
        # Hard limits
        self.max_db = 6.0
        self.min_db = -12.0

    def forward(self, x):
        # Clamping gains
        clamped_gains = torch.clamp(self.gains, self.min_db, self.max_db)
        # Apply gains (simplified spectral multiplication)
        return x * (10**(clamped_gains / 20.0))

if __name__ == "__main__":
    eq = DifferentiableEQ()
    test_input = torch.ones(31)
    output = eq(test_input)
    print(f"Output shape: {output.shape}")
    print(f"Output check: {torch.all(output <= 10**(6.0/20.0))}")
