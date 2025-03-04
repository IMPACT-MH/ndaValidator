"use client";

import { useState, useEffect } from "react";
import { Search, X, AlertCircle, Info } from "lucide-react";

const DataElementSearch = ({ onStructureSelect }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [element, setElement] = useState(null);
    const [matchingElements, setMatchingElements] = useState([]);
    const [isPartialSearch, setIsPartialSearch] = useState(false);
    const [recentSearches, setRecentSearches] = useState([]);

    useEffect(() => {
        const saved = localStorage.getItem("elementSearchHistory");
        if (saved) {
            setRecentSearches(JSON.parse(saved));
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(
            "elementSearchHistory",
            JSON.stringify(recentSearches)
        );
    }, [recentSearches]);

    const updateRecentSearches = (newTerm) => {
        if (!recentSearches.includes(newTerm)) {
            setRecentSearches((prev) => [newTerm, ...prev].slice(0, 10));
        }
    };

    // Helper to check for matches
    const checkForMatches = (text, searchTerms) => {
        if (!text) return false;
        const textLower = text.toLowerCase();
        return searchTerms.some((term) =>
            textLower.includes(term.toLowerCase())
        );
    };

    // Escape special characters for regex
    const escapeRegExp = (string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    };

    // Update the rendering section to include highlighting
    const highlightSearchTerm = (text, searchTerms) => {
        if (!text || !searchTerms?.length) return text;

        try {
            // Create pattern that matches any of the search terms
            const pattern = searchTerms
                .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join("|");
            const regex = new RegExp(`(${pattern})`, "gi");

            const parts = text.split(regex);
            return parts.map((part, i) => {
                const isMatch = searchTerms.some(
                    (term) => part.toLowerCase() === term.toLowerCase()
                );
                return isMatch ? (
                    <span key={i} className="bg-yellow-200 font-medium">
                        {part}
                    </span>
                ) : (
                    part
                );
            });
        } catch (err) {
            console.error("Error highlighting text:", err);
            return text;
        }
    };

    const levenshteinDistance = (str1, str2) => {
        const track = Array(str2.length + 1)
            .fill(null)
            .map(() => Array(str1.length + 1).fill(null));
        for (let i = 0; i <= str1.length; i++) track[0][i] = i;
        for (let j = 0; j <= str2.length; j++) track[j][0] = j;
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                track[j][i] = Math.min(
                    track[j][i - 1] + 1,
                    track[j - 1][i] + 1,
                    track[j - 1][i - 1] + indicator
                );
            }
        }
        return track[str2.length][str1.length];
    };

    const calculateRelevance = (element, searchTerm) => {
        let score = 0;
        const elementName = element.name.toLowerCase();
        const searchTermLower = searchTerm.toLowerCase();

        // First look for the search term in the element name parts
        const elementParts = elementName.split("_");
        const searchParts = searchTermLower.split("_");

        // Perfect match gets highest score
        if (elementName === searchTermLower) {
            return 1000;
        }

        // Calculate Levenshtein distance between search parts and element parts
        for (let i = 0; i < searchParts.length; i++) {
            const searchPart = searchParts[i];
            let bestPartDistance = Infinity;

            for (let j = 0; j < elementParts.length; j++) {
                const elementPart = elementParts[j];
                const distance = levenshteinDistance(searchPart, elementPart);
                bestPartDistance = Math.min(bestPartDistance, distance);
            }

            // Heavily weight exact part matches
            if (bestPartDistance === 0) {
                score += 100;
            } else if (bestPartDistance <= 2) {
                // Allow for small typos
                score += 50 / bestPartDistance;
            }
        }

        // Look for exact prefix matches with remaining parts
        if (elementName.startsWith(searchTermLower + "_")) {
            score += 500;
        }

        // Penalize matches that are just based on numbers
        if (elementName.match(/^\d+$/) || searchTermLower.match(/^\d+$/)) {
            score *= 0.1;
        }

        // Severely penalize matches only found in description
        if (!elementName.includes(searchTermLower)) {
            score *= 0.1;
        }

        return score;
    };

    const handleSearch = async () => {
        if (!searchTerm.trim()) return;

        setLoading(true);
        setError(null);
        setElement(null);
        setMatchingElements([]);
        setIsPartialSearch(false);

        try {
            // First try exact match
            const directResponse = await fetch(
                `https://nda.nih.gov/api/datadictionary/dataelement/${searchTerm.trim()}`
            );

            if (directResponse.ok) {
                const data = await directResponse.json();
                setElement(data);
                updateRecentSearches(searchTerm.trim());
                setLoading(false);
                return;
            }

            // If no exact match, use the search API
            const searchQuery = searchTerm.trim();
            const partialResponse = await fetch(
                `https://nda.nih.gov/api/search/nda/dataelement/full?size=10000&highlight=true`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "text/plain",
                    },
                    body: searchQuery,
                }
            );

            if (!partialResponse.ok) {
                throw new Error("Failed to fetch matching elements");
            }

            const searchResults = await partialResponse.json();

            if (!searchResults?.datadict?.results?.length) {
                setError(`No data elements found containing "${searchTerm}"`);
                setLoading(false);
                return;
            }

            // Get full details for each result
            const elementDetails = await Promise.all(
                searchResults.datadict.results.map(async (result) => {
                    try {
                        const response = await fetch(
                            `https://nda.nih.gov/api/datadictionary/dataelement/${result.name}`
                        );

                        if (!response.ok) {
                            throw new Error(
                                `Failed to fetch details for ${result.name}`
                            );
                        }

                        const fullData = await response.json();

                        // Use the API's _score for relevance
                        return {
                            name: result.name,
                            type: fullData.type || result.type || "Text",
                            description:
                                fullData.description ||
                                "No description available",
                            notes: fullData.notes,
                            dataStructures:
                                result.dataStructures?.map((ds) => ({
                                    shortName: ds.shortName,
                                    title: ds.title || "",
                                    category: ds.category || "",
                                })) || [],
                            total_data_structures:
                                result.dataStructures?.length || 0,
                            _score: result._score,
                            searchTerms: [searchQuery],
                            matchType: result.name
                                .toLowerCase()
                                .includes(searchQuery.toLowerCase())
                                ? "name"
                                : "description",
                        };
                    } catch (err) {
                        console.error(
                            `Error fetching details for ${result.name}:`,
                            err
                        );
                        return null;
                    }
                })
            );

            // Filter out null results and sort by API's _score
            const validElements = elementDetails
                .filter(Boolean)
                .sort((a, b) => (b._score || 0) - (a._score || 0));

            setMatchingElements(validElements);
            setIsPartialSearch(true);
            updateRecentSearches(searchTerm.trim());
        } catch (err) {
            console.error("Search error:", err);
            setError(`Error searching for elements: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter") {
            handleSearch();
        }
    };

    const handleClear = () => {
        setSearchTerm("");
        setElement(null);
        setError(null);
        setMatchingElements([]);
        setIsPartialSearch(false);
    };

    const handleRecentSearch = async (term) => {
        setSearchTerm(term);
        await handleSearch();
    };

    return (
        <div className="space-y-6">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-4">Data Element Search</h1>
                <p className="text-gray-600 mb-6">
                    Search for specific data elements to view their details,
                    value ranges, and associated data structures.
                </p>
                <div className="relative">
                    <input
                        type="text"
                        className="w-full p-4 pl-12 border rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Search element names and descriptions..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <Search
                        className="absolute left-4 top-4 text-gray-400"
                        size={20}
                    />
                    {searchTerm && (
                        <button
                            onClick={handleClear}
                            className="absolute right-16 top-4 text-gray-400 hover:text-gray-600"
                            aria-label="Clear search"
                        >
                            <X size={16} />
                        </button>
                    )}
                    <button
                        onClick={handleSearch}
                        disabled={!searchTerm.trim() || loading}
                        className="absolute right-2 top-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300"
                    >
                        Search
                    </button>
                </div>

                {recentSearches.length > 0 && (
                    <div className="mt-3">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm text-gray-500">
                                Recent searches:
                            </h3>
                            <button
                                onClick={() => {
                                    setRecentSearches([]);
                                    localStorage.removeItem(
                                        "elementSearchHistory"
                                    );
                                }}
                                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                            >
                                Clear all
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {recentSearches.map((term, index) => (
                                <div key={index} className="group relative">
                                    <button
                                        onClick={() => handleRecentSearch(term)}
                                        className="px-3 py-1 text-sm bg-gray-100 group-hover:bg-gray-200 rounded-full text-gray-700"
                                    >
                                        {term}
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setRecentSearches(
                                                recentSearches.filter(
                                                    (_, i) => i !== index
                                                )
                                            );
                                        }}
                                        className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-200 hover:bg-gray-300 rounded-full w-4 h-4 flex items-center justify-center text-xs text-gray-600"
                                        aria-label="Remove search term"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {loading && (
                <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-2 text-gray-600">
                        Searching for elements...
                    </p>
                </div>
            )}

            {error && (
                <div className="bg-red-50 p-4 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-1 flex-shrink-0" />
                    <div>
                        <h4 className="font-medium text-red-800">Error</h4>
                        <p className="text-red-700">{error}</p>
                    </div>
                </div>
            )}

            {isPartialSearch && matchingElements.length > 0 && (
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="bg-green-50 p-4 border-b border-green-100">
                        <h2 className="text-lg font-medium text-green-800">
                            Found {matchingElements.length} elements containing
                            "{searchTerm}"
                        </h2>
                        <p className="text-sm text-green-700 mt-1">
                            Results are sorted by relevance score
                        </p>
                    </div>

                    <div className="divide-y">
                        {matchingElements.map((match, index) => (
                            <div
                                key={index}
                                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                                onClick={async () => {
                                    // Fetch full element details when clicking a result
                                    try {
                                        const response = await fetch(
                                            `https://nda.nih.gov/api/datadictionary/dataelement/${match.name}`
                                        );
                                        if (response.ok) {
                                            const fullData =
                                                await response.json();
                                            setElement(fullData);
                                            setIsPartialSearch(false);
                                        } else {
                                            throw new Error(
                                                "Failed to fetch element details"
                                            );
                                        }
                                    } catch (err) {
                                        console.error(
                                            "Error fetching element details:",
                                            err
                                        );
                                        // Fallback to search result data if fetch fails
                                        setElement(match);
                                        setIsPartialSearch(false);
                                    }
                                }}
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="font-mono text-blue-600 font-medium flex items-center gap-2">
                                            {match.name}
                                            <span className="text-xs bg-blue-100 px-2 py-1 rounded text-blue-800">
                                                {match.type}
                                            </span>
                                            <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">
                                                Score:{" "}
                                                {match._score?.toFixed(2)}
                                            </span>
                                            {match.matchType ===
                                                "description" && (
                                                <span className="text-xs bg-purple-100 px-2 py-1 rounded text-purple-800">
                                                    Found in description
                                                </span>
                                            )}
                                        </h3>
                                    </div>
                                </div>

                                {match.description && (
                                    <p className="text-sm text-gray-700 mt-2">
                                        {highlightSearchTerm(
                                            match.description,
                                            match.searchTerms
                                        )}
                                    </p>
                                )}

                                {match.dataStructures?.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {match.dataStructures.map(
                                            (structure, idx) => (
                                                <span
                                                    key={idx}
                                                    className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 cursor-pointer hover:bg-gray-200 group relative"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onStructureSelect(
                                                            structure.shortName
                                                        );
                                                    }}
                                                >
                                                    {structure.shortName}
                                                    {structure.title && (
                                                        <div className="absolute hidden group-hover:block bg-gray-800 text-white p-2 rounded shadow-lg text-xs -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10">
                                                            {structure.title}
                                                        </div>
                                                    )}
                                                </span>
                                            )
                                        )}
                                    </div>
                                )}

                                {match.notes && (
                                    <div className="mt-2 text-xs text-gray-600">
                                        <span className="font-medium">
                                            Notes:{" "}
                                        </span>
                                        {match.notes}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {element && !isPartialSearch && (
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="bg-blue-50 p-5 border-b border-blue-100">
                        <h2 className="text-2xl font-mono font-semibold text-blue-800">
                            {element.name}
                        </h2>
                        <div className="flex items-center mt-2">
                            <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                                {element.type}
                                {element.size && <span> ({element.size})</span>}
                            </span>
                            <span className="text-sm text-gray-500 ml-3">
                                Found in {element.dataStructures?.length || 0}{" "}
                                data structures
                            </span>
                        </div>
                    </div>

                    <div className="p-5 space-y-6">
                        {/* Description */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-800 mb-2">
                                Description
                            </h3>
                            <p className="text-gray-700">
                                {element.description ||
                                    "No description available"}
                            </p>
                        </div>

                        {/* Value Range */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-800 mb-2">
                                Value Range
                            </h3>
                            {element.valueRange ? (
                                <div className="bg-gray-50 p-3 rounded font-mono text-sm">
                                    {element.valueRange}
                                </div>
                            ) : (
                                <p className="text-gray-500 italic">
                                    No value range specified
                                </p>
                            )}
                        </div>

                        {/* Notes */}
                        {element.notes && (
                            <div>
                                <h3 className="text-lg font-medium text-gray-800 mb-2">
                                    Notes
                                </h3>
                                <div className="bg-yellow-50 p-3 rounded border-l-4 border-yellow-300">
                                    <p className="text-gray-800">
                                        {element.notes}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Data Structures section */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-800 mb-2">
                                Used in Data Structures
                            </h3>
                            {element.dataStructures?.length > 0 ? (
                                <div className="bg-gray-50 p-3 rounded max-h-64 overflow-y-auto">
                                    <ul className="space-y-1">
                                        {element.dataStructures.map(
                                            (structure, index) => (
                                                <li
                                                    key={index}
                                                    className="font-mono text-sm hover:bg-blue-50 p-1 rounded cursor-pointer text-blue-600 hover:text-blue-800 transition-colors"
                                                    onClick={() =>
                                                        onStructureSelect(
                                                            structure
                                                        )
                                                    }
                                                >
                                                    {structure}
                                                </li>
                                            )
                                        )}
                                    </ul>
                                </div>
                            ) : (
                                <p className="text-gray-500 italic">
                                    Not found in any data structures s b
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {!loading &&
                !error &&
                !element &&
                !isPartialSearch &&
                searchTerm && (
                    <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3">
                        <Info className="w-5 h-5 text-blue-500 mt-1 flex-shrink-0" />
                        <div>
                            <h4 className="font-medium text-blue-800">
                                Searching Tips
                            </h4>
                            <p className="text-blue-700 mt-1">
                                Enter a full or partial data element name and
                                press Enter or click Search.
                            </p>
                            <p className="text-sm text-blue-600 mt-2">
                                Common element names: subjectkey, gender, age,
                                visit_date, handedness
                            </p>
                        </div>
                    </div>
                )}
        </div>
    );
};

export default DataElementSearch;
