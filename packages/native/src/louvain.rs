// @askhagraph/native — Louvain community detection algorithm
// Implements the Louvain modularity optimization method for graph clustering.
// Exposed to TypeScript via napi-rs.

use std::collections::HashMap;

/// Input edge for the Louvain algorithm.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct LouvainEdge {
    pub source: String,
    pub target: String,
    /// Optional edge weight (default: 1.0).
    pub weight: Option<f64>,
}

/// Result of Louvain community detection.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct LouvainResult {
    /// Map of node ID to community ID.
    pub communities: Vec<LouvainCommunityAssignment>,
    /// Final modularity score (0.0 to 1.0, higher = better partition).
    pub modularity: f64,
    /// Number of communities detected.
    pub num_communities: u32,
}

/// A single node-to-community assignment.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct LouvainCommunityAssignment {
    pub node_id: String,
    pub community_id: u32,
}

/// Run Louvain community detection on a graph.
///
/// Takes a list of node IDs and edges, returns community assignments.
/// The algorithm optimizes modularity by iteratively moving nodes between
/// communities and then aggregating communities into super-nodes.
#[napi]
pub fn detect_communities(
    node_ids: Vec<String>,
    edges: Vec<LouvainEdge>,
) -> LouvainResult {
    if node_ids.is_empty() {
        return LouvainResult {
            communities: Vec::new(),
            modularity: 0.0,
            num_communities: 0,
        };
    }

    if edges.is_empty() || node_ids.len() < 2 {
        // Each node is its own community
        let communities: Vec<LouvainCommunityAssignment> = node_ids
            .iter()
            .enumerate()
            .map(|(i, id)| LouvainCommunityAssignment {
                node_id: id.clone(),
                community_id: i as u32,
            })
            .collect();
        return LouvainResult {
            num_communities: communities.len() as u32,
            communities,
            modularity: 0.0,
        };
    }

    // Map node IDs to indices for efficient computation
    let node_to_idx: HashMap<&str, usize> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let n = node_ids.len();

    // Build adjacency with weights
    let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    let mut total_weight = 0.0;

    for edge in &edges {
        let w = edge.weight.unwrap_or(1.0);
        if let (Some(&src), Some(&tgt)) = (
            node_to_idx.get(edge.source.as_str()),
            node_to_idx.get(edge.target.as_str()),
        ) {
            if src != tgt {
                adj[src].push((tgt, w));
                adj[tgt].push((src, w));
                total_weight += w;
            }
        }
    }

    if total_weight == 0.0 {
        let communities: Vec<LouvainCommunityAssignment> = node_ids
            .iter()
            .enumerate()
            .map(|(i, id)| LouvainCommunityAssignment {
                node_id: id.clone(),
                community_id: i as u32,
            })
            .collect();
        return LouvainResult {
            num_communities: communities.len() as u32,
            communities,
            modularity: 0.0,
        };
    }

    let m2 = 2.0 * total_weight; // 2m in the modularity formula

    // Compute weighted degree for each node
    let mut k: Vec<f64> = vec![0.0; n];
    for i in 0..n {
        for &(_, w) in &adj[i] {
            k[i] += w;
        }
    }

    // Initialize: each node in its own community
    let mut community: Vec<usize> = (0..n).collect();

    // Sum of weights inside each community
    let mut sigma_in: Vec<f64> = vec![0.0; n];
    // Sum of total weights of nodes in each community
    let mut sigma_tot: Vec<f64> = k.clone();

    // Phase 1: Local moving — iterate until no improvement
    let max_iterations = 20;
    for _iteration in 0..max_iterations {
        let mut improved = false;

        for i in 0..n {
            let current_comm = community[i];
            let ki = k[i];

            // Compute weights to each neighboring community
            let mut comm_weights: HashMap<usize, f64> = HashMap::new();
            for &(j, w) in &adj[i] {
                let cj = community[j];
                *comm_weights.entry(cj).or_insert(0.0) += w;
            }

            // Remove node i from its current community
            let ki_in_current = comm_weights.get(&current_comm).copied().unwrap_or(0.0);
            sigma_in[current_comm] -= ki_in_current;
            sigma_tot[current_comm] -= ki;

            // Find the best community to move to
            let mut best_comm = current_comm;
            let mut best_delta = 0.0;

            for (&target_comm, &ki_in_target) in &comm_weights {
                // Modularity gain of moving node i to target_comm
                let delta = ki_in_target / m2
                    - (sigma_tot[target_comm] * ki) / (m2 * m2 / 2.0);

                // Compare against staying removed (delta for current community is the baseline)
                let delta_current = ki_in_current / m2
                    - (sigma_tot[current_comm] * ki) / (m2 * m2 / 2.0);

                if delta - delta_current > best_delta {
                    best_delta = delta - delta_current;
                    best_comm = target_comm;
                }
            }

            // Move node i to the best community
            community[i] = best_comm;
            let ki_in_best = comm_weights.get(&best_comm).copied().unwrap_or(0.0);
            sigma_in[best_comm] += ki_in_best;
            sigma_tot[best_comm] += ki;

            if best_comm != current_comm {
                improved = true;
            }
        }

        if !improved {
            break;
        }
    }

    // Renumber communities to be contiguous (0, 1, 2, ...)
    let mut comm_map: HashMap<usize, u32> = HashMap::new();
    let mut next_id: u32 = 0;
    for &c in &community {
        if !comm_map.contains_key(&c) {
            comm_map.insert(c, next_id);
            next_id += 1;
        }
    }

    let communities: Vec<LouvainCommunityAssignment> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| LouvainCommunityAssignment {
            node_id: id.clone(),
            community_id: *comm_map.get(&community[i]).unwrap_or(&0),
        })
        .collect();

    // Compute final modularity
    let modularity = compute_modularity(&community, &adj, &k, m2);

    LouvainResult {
        num_communities: next_id,
        communities,
        modularity,
    }
}

/// Compute the modularity Q of a partition.
/// Q = (1/2m) * Σ_ij [ A_ij - (k_i * k_j) / 2m ] * δ(c_i, c_j)
fn compute_modularity(
    community: &[usize],
    adj: &[Vec<(usize, f64)>],
    k: &[f64],
    m2: f64,
) -> f64 {
    if m2 == 0.0 {
        return 0.0;
    }

    let mut q = 0.0;
    let n = community.len();

    for i in 0..n {
        for &(j, w) in &adj[i] {
            if community[i] == community[j] {
                q += w - (k[i] * k[j]) / m2;
            }
        }
    }

    q / m2
}
