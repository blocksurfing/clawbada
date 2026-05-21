export const RepairShopAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "clawToken_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "lobsterNFT_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "treasury_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "REPAIR_RATES",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clawToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lobsterNFT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LobsterNFT"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "repair",
    "inputs": [
      {
        "name": "lobsterId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "pointsToRepair",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Treasury"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "LobsterRepaired",
    "inputs": [
      {
        "name": "lobsterId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "pointsRepaired",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "newDamage",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "cost",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CannotRepairBaseTier",
    "inputs": [
      {
        "name": "lobsterId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExceedsCurrentDamage",
    "inputs": [
      {
        "name": "lobsterId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "requested",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "actual",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLobsterOwner",
    "inputs": [
      {
        "name": "lobsterId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToRepair",
    "inputs": [
      {
        "name": "lobsterId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroRepairPoints",
    "inputs": []
  }
] as const;
