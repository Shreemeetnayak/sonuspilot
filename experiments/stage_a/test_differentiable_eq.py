import torch
import unittest
from differentiable_eq import Differentiable31BandEQ, ISO_BANDS

class TestDifferentiable31BandEQ(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(42)
        self.eq = Differentiable31BandEQ()
        self.samples = 44100
        self.audio = torch.randn(1, self.samples) * 0.1
        self.zero_gains = torch.zeros(1, 31)

    def test_identity_eq_is_near_lossless(self):
        output = self.eq(self.audio, self.zero_gains)
        self.assertTrue(torch.allclose(output, self.audio, atol=1e-5))

    def test_gain_at_band_changes_sine_level(self):
        t = torch.arange(self.samples) / 44100.0
        sine = (0.1 * torch.sin(2 * torch.pi * 1000.0 * t)).unsqueeze(0)
        gains = self.zero_gains.clone()
        gains[0, 17] = 6.0
        output = self.eq(sine, gains)
        ratio = torch.sqrt(torch.mean(output**2)) / torch.sqrt(torch.mean(sine**2))
        self.assertGreater(ratio.item(), 1.8)
        self.assertLess(ratio.item(), 2.1)

    def test_gradients_exist(self):
        gains = torch.zeros(1, 31, requires_grad=True)
        output = self.eq(self.audio, gains)
        loss = output.square().mean()
        loss.backward()
        self.assertIsNotNone(gains.grad)
        self.assertTrue(torch.isfinite(gains.grad).all())

    def test_gain_limits_apply(self):
        gains = torch.full((1, 31), 100.0)
        output = self.eq(self.audio, gains)
        max_ratio = output.abs().max() / self.audio.abs().max()
        self.assertLessEqual(max_ratio.item(), 10 ** (6.0 / 20.0) + 1e-4)

    def test_output_is_finite_for_silence(self):
        silence = torch.zeros(1, self.samples)
        output = self.eq(silence, torch.ones(1, 31) * 6)
        self.assertTrue(torch.isfinite(output).all())
        self.assertEqual(output.abs().max().item(), 0.0)

if __name__ == '__main__':
    unittest.main()
