export const DNALibAbi = [
  {
    "type": "error",
    "name": "InvalidBodyPartSlot",
    "inputs": [
      {
        "name": "slot",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBreedType",
    "inputs": [
      {
        "name": "breedType",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClass",
    "inputs": [
      {
        "name": "class_",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClassAffinity",
    "inputs": [
      {
        "name": "affinity",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidLegend",
    "inputs": [
      {
        "name": "legend",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  }
] as const;
