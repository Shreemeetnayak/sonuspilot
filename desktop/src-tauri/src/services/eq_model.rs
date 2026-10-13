use serde::{Deserialize, Serialize};
// use tch::{nn, Device, Tensor, Kind};

#[derive(Debug, Serialize, Deserialize)]
pub struct EQWeights {
    pub weights: Vec<Vec<f32>>,
}

pub struct EQModel {
    // network: nn::Sequential,
}

impl EQModel {
    pub fn new() -> Self {
        // let vs = nn::VarStore::new(Device::Cpu);
        // let network = nn::seq()
        //     .add(nn::linear(vs.root(), 31, 64, Default::default()))
        //     .add_fn(|xs| xs.relu())
        //     .add(nn::linear(vs.root(), 64, 31, Default::default()))
        //     .add_fn(|xs| xs.tanh());
        //
        // EQModel { network }
        EQModel {}
    }
}
